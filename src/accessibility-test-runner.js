import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, executionError } from './core/error/repo-guard-error.js';
import micromatch from 'micromatch';
import { DEFAULT_ACCESSIBILITY_TEST_CONFIG } from './config.js';
import { processOutputDiagnostics } from './core/execution/process-output.js';
import { processFailureFinding } from './core/report/guidance-catalog.js';
import { createGateResult } from './core/result/gate-result.js';
import { collectProjectFiles } from './file-placement.js';
import { resolveProjectPackageMetadata } from './core/project/package.js';
import { analyzeUnitTestContent } from './unit-test-runner.js';

const INTEGRATIONS = Object.freeze([
  Object.freeze({
    id: 'vitest-axe',
    packageName: 'vitest-axe',
    displayName: 'vitest-axe',
    scan: /\baxe\s*\(/,
    assertion: /\btoHaveNoViolations\s*\(/,
  }),
  Object.freeze({
    id: 'jest-axe',
    packageName: 'jest-axe',
    displayName: 'jest-axe',
    scan: /\baxe\s*\(/,
    assertion: /\btoHaveNoViolations\s*\(/,
  }),
  Object.freeze({
    id: 'playwright',
    packageName: '@axe-core/playwright',
    displayName: '@axe-core/playwright',
    scan: /\bnew\s+AxeBuilder\s*\([^)]*\)[\s\S]*?\.analyze\s*\(/,
    assertion: /\.violations\b[\s\S]{0,300}?(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))|(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))[\s\S]{0,300}?\.violations\b/,
  }),
  Object.freeze({
    id: 'cypress',
    packageName: 'cypress-axe',
    displayName: 'cypress-axe',
    scan: /\bcy\s*\.\s*checkA11y\s*\(/,
    assertion: /\bcy\s*\.\s*checkA11y\s*\(/,
    setup: /\bcy\s*\.\s*injectAxe\s*\(/,
  }),
  Object.freeze({
    id: 'axe-core',
    packageName: 'axe-core',
    displayName: 'axe-core',
    scan: /\baxe\s*\.\s*run\s*\(/,
    assertion: /\.violations\b[\s\S]{0,300}?(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))|(?:toEqual\s*\(\s*\[\s*\]\s*\)|toHaveLength\s*\(\s*0\s*\))[\s\S]{0,300}?\.violations\b/,
  }),
]);

const BYPASS_PATTERNS = Object.freeze([
  Object.freeze({ expression: 'disableRules', pattern: /\.\s*disableRules\s*\(/ }),
  Object.freeze({ expression: 'exclude', pattern: /\.\s*exclude\s*\(/ }),
  Object.freeze({ expression: 'withRules', pattern: /\.\s*withRules\s*\(/ }),
  Object.freeze({ expression: 'withTags', pattern: /\.\s*withTags\s*\(/ }),
  Object.freeze({ expression: 'runOnly', pattern: /\brunOnly\s*:/ }),
  Object.freeze({ expression: 'includedImpacts', pattern: /\bincludedImpacts\s*:/ }),
  Object.freeze({
    expression: 'axe rule enabled: false',
    pattern: /\brules\s*:\s*\{[\s\S]{0,500}?\benabled\s*:\s*false\b/,
  }),
]);

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError(
      'accessibility-test/missing-package-manifest',
      'package.json was not found in repository root',
      { details: { location: { path: 'package.json' } } },
    );
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

function stripComments(source) {
  let output = '';
  let state = 'code';
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      output += character === '\n' ? '\n' : ' ';
      if (character === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      output += /[\r\n]/.test(character) ? character : ' ';
      if (character === '*' && next === '/') {
        output += ' ';
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'string') {
      output += character;
      if (character === '\\' && next != null) {
        output += next;
        index += 1;
      } else if (character === quote) {
        state = 'code';
      }
      continue;
    }
    if (character === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block-comment';
    } else if (character === '"' || character === "'" || character === '`') {
      output += character;
      quote = character;
      state = 'string';
    } else {
      output += character;
    }
  }
  return output;
}

function maskStringsAndComments(source) {
  const withoutComments = stripComments(source);
  let output = '';
  let quote = '';
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    const next = withoutComments[index + 1];
    if (quote) {
      output += /[\r\n]/.test(character) ? character : ' ';
      if (character === '\\' && next != null) {
        output += /[\r\n]/.test(next) ? next : ' ';
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      output += ' ';
      quote = character;
    } else {
      output += character;
    }
  }
  return output;
}

function importedIntegration(code) {
  return INTEGRATIONS.find(({ packageName }) => (
    new RegExp(
      `(?:from\\s*|import\\s*(?:\\(|)|require\\s*\\()\\s*['"]${packageName.replace('/', '\\/')}['"]`,
    ).test(code)
  ));
}

function sourceLine(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

export function analyzeAccessibilityTestContent(source) {
  const imports = stripComments(source);
  const code = maskStringsAndComments(source);
  const testAnalysis = analyzeUnitTestContent(source);
  const integration = importedIntegration(imports);
  const bypasses = [...testAnalysis.bypasses];
  for (const candidate of BYPASS_PATTERNS) {
    const match = candidate.pattern.exec(code);
    if (match) {
      bypasses.push({
        expression: candidate.expression,
        line: sourceLine(code, match.index),
      });
    }
  }
  return {
    assertion: Boolean(integration?.assertion.test(code)),
    bypasses,
    hasTestCase: testAnalysis.hasTestCase,
    integration: integration?.id ?? null,
    packageName: integration?.packageName ?? null,
    scan: Boolean(integration?.scan.test(code)),
    setup: integration?.setup ? integration.setup.test(code) : true,
  };
}

function normalizedFiles(root, patterns) {
  return collectProjectFiles(root)
    .filter((relative) => micromatch.isMatch(relative, patterns, { dot: true }))
    .map((relative) => ({
      absolute: path.join(root, relative),
      relative,
    }));
}

export function inspectAccessibilityTestSetup(
  root,
  config = DEFAULT_ACCESSIBILITY_TEST_CONFIG,
) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  const problems = [];
  if (typeof command !== 'string' || !command.trim()) {
    problems.push({
      code: 'missing-script',
      path: 'package.json',
      message: `缺少非空 npm script "${config.script}"`,
      remediation: `新增独立的 "${config.script}" 脚本，只运行 axe 组件或 E2E 可访问性测试`,
    });
  } else if (/^(?:echo(?:\s|$)|true\s*$|exit\s+0\s*$)/i.test(command.trim())) {
    problems.push({
      code: 'no-op-script',
      path: 'package.json',
      message: `npm script "${config.script}" 是明显的空操作：${command.trim()}`,
      remediation: '把脚本改为实际运行匹配可访问性测试的 Vitest、Jest、Playwright 或 Cypress 命令',
    });
  }

  const files = normalizedFiles(root, config.testPatterns);
  if (files.length === 0) {
    problems.push({
      code: 'missing-test-files',
      path: '.',
      message: `没有文件匹配 accessibilityTest.testPatterns：${config.testPatterns.join(', ')}`,
      remediation: '新增至少一个命名明确的可访问性测试文件，并覆盖关键组件状态或关键页面流程',
    });
  }

  const integrations = new Map();
  for (const file of files) {
    const source = readFileSync(file.absolute, 'utf8');
    const analysis = analyzeAccessibilityTestContent(source);
    if (!analysis.hasTestCase) {
      problems.push({
        code: 'missing-test-case',
        path: file.relative,
        message: '文件没有可执行的 test/it 用例',
        remediation: '添加正常执行的可访问性测试用例，不得使用 skip、todo 或 only',
      });
    }
    if (!analysis.integration) {
      problems.push({
        code: 'missing-axe-integration',
        path: file.relative,
        message: '文件没有直接导入受支持的 axe 集成',
        remediation: '直接导入 vitest-axe、jest-axe、@axe-core/playwright、cypress-axe 或 axe-core，并在本文件执行扫描',
      });
    } else {
      integrations.set(analysis.packageName, null);
      if (!analysis.setup) {
        problems.push({
          code: 'missing-axe-setup',
          path: file.relative,
          message: 'Cypress 可访问性测试没有在扫描前调用 cy.injectAxe()',
          remediation: '页面加载完成后调用 cy.injectAxe()，再调用 cy.checkA11y()',
        });
      }
      if (!analysis.scan) {
        problems.push({
          code: 'missing-axe-scan',
          path: file.relative,
          message: '文件虽然导入 axe 集成，但没有执行可识别的 axe 扫描',
          remediation: '对渲染后的组件容器或稳定页面执行 axe/axe.run/AxeBuilder.analyze/cy.checkA11y',
        });
      }
      if (!analysis.assertion) {
        problems.push({
          code: 'missing-zero-violation-assertion',
          path: file.relative,
          message: 'axe 扫描结果没有零违规硬断言，测试可能在发现违规后仍然成功',
          remediation: '使用 toHaveNoViolations，或断言 results.violations 等于 [] 或长度为 0；Cypress 使用 cy.checkA11y()',
        });
      }
    }
    for (const bypass of analysis.bypasses) {
      problems.push({
        code: 'test-bypass',
        path: file.relative,
        line: bypass.line,
        message: `发现可访问性测试绕过：${bypass.expression}`,
        remediation: '移除跳过、规则禁用、DOM 排除或影响级别过滤，修复真实可访问性问题并让完整扫描通过',
      });
    }
  }

  for (const packageName of integrations.keys()) {
    const definition = INTEGRATIONS.find((item) => item.packageName === packageName);
    try {
      integrations.set(packageName, resolveProjectPackageMetadata(
        root,
        packageName,
        definition.displayName,
      ));
    } catch (error) {
      problems.push({
        code: 'missing-integration-package',
        path: 'package.json',
        message: error.message,
        remediation: `将 ${packageName} 安装为当前项目的精确 devDependency，并提交同步的锁文件`,
      });
    }
  }

  return {
    command: typeof command === 'string' ? command.trim() : null,
    files,
    integrations: [...integrations.entries()].map(([name, metadata]) => ({
      name,
      version: metadata?.version ?? null,
    })),
    problems,
  };
}

export function validateAccessibilityTestSetup(root, config) {
  const result = inspectAccessibilityTestSetup(root, config);
  if (result.problems.length > 0) {
    throw configurationError(
      'accessibility-test/invalid-setup',
      result.problems.map((problem) => (
        `${problem.path}${problem.line ? `:${problem.line}` : ''}: ${problem.message}`
      )).join('\n'),
      {
        details: {
          evidence: result.problems.map((problem) => ({
            type: 'configuration-check',
            message: problem.message,
            location: {
              path: problem.path,
              ...(problem.line ? { line: problem.line } : {}),
            },
          })),
        },
      },
    );
  }
  return result;
}

export function detectProjectAccessibilityTestSetup(root, config) {
  try {
    return { ready: true, setup: validateAccessibilityTestSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}


function runNpmScript(root, config) {
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${config.script}`]
    : ['run', config.script];
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}

export function runAccessibilityTestGate({ root, config }) {
  const inspection = inspectAccessibilityTestSetup(root, config);
  if (inspection.problems.length > 0) {
    return createGateResult({
      gateId: 'quality.accessibility-test',
      status: 'configuration-error',
      summary: `Accessibility test setup has ${inspection.problems.length} problem(s)`,
      error: configurationError(
        'accessibility-test/invalid-setup',
        'Accessibility test setup is invalid',
      ),
      findings: inspection.problems.map((problem) => ({
        kind: 'configuration',
        ruleId: `accessibility-test/${problem.code}`,
        code: problem.code,
        severity: 'error',
        message: problem.message,
        location: {
          path: problem.path,
          ...(problem.line ? { line: problem.line } : {}),
        },
        expected: '可访问性测试必须具有可执行的 axe 扫描、零违规断言和完整依赖。',
        remediation: problem.remediation,
        decision: {
          aiAction: 'update-tests-or-configuration',
          humanApprovalRequired: false,
        },
      })),
    });
  }
  const integrations = inspection.integrations
    .map(({ name, version }) => `${name} ${version}`)
    .join(', ');
  const diagnostics = [{ level: 'info', message:
    `repo-guard accessibility tests: ${integrations}; `
    + `${inspection.files.length} file(s), running npm script "${config.script}"...` }];
  const result = runNpmScript(root, config);
  diagnostics.push(...processOutputDiagnostics(result, { source: 'axe', root }));
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return createGateResult({
        gateId: 'quality.accessibility-test',
        status: 'execution-error',
        summary: `Accessibility tests exceeded ${config.timeoutMs}ms`,
        error: executionError(
          'accessibility-test/timeout',
          `Accessibility tests exceeded ${config.timeoutMs}ms`,
          { cause: result.error },
        ),
        diagnostics,
      });
    }
    const error = executionError(
      'accessibility-test/process-start-failed',
      `Unable to run accessibility tests: ${result.error.message}`,
      { cause: result.error },
    );
    return createGateResult({
      gateId: 'quality.accessibility-test',
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
    });
  }
  if (result.status !== 0) {
    return createGateResult({
      gateId: 'quality.accessibility-test',
      status: 'violation',
      summary: `Accessibility tests failed with exit code ${result.status ?? 1}`,
      diagnostics,
      findings: [processFailureFinding('quality.accessibility-test', {
        exitCode: result.status ?? 1,
        script: config.script,
      })],
      metrics: { testFiles: inspection.files.length },
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard accessibility tests passed.' });
  return createGateResult({
    gateId: 'quality.accessibility-test',
    status: 'passed',
    summary: `Accessibility tests passed (${integrations}; ${inspection.files.length} file(s))`,
    diagnostics,
    metrics: { testFiles: inspection.files.length },
  });
}
