import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import micromatch from 'micromatch';
import { DEFAULT_ACCESSIBILITY_TEST_CONFIG } from '../../config/defaults.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import {
  inspectAxeIntegration,
  resolveAxeIntegrationPackage,
} from '../../integrations/axe/project.js';
import { analyzeUnitTestContent } from '../../integrations/vitest/source-analysis.js';

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

function sourceLine(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

export function analyzeAccessibilityTestContent(source) {
  const imports = stripComments(source);
  const code = maskStringsAndComments(source);
  const testAnalysis = analyzeUnitTestContent(source);
  const integration = inspectAxeIntegration(imports, code);
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
    assertion: integration?.assertion ?? false,
    bypasses,
    hasTestCase: testAnalysis.hasTestCase,
    integration: integration?.id ?? null,
    packageName: integration?.packageName ?? null,
    scan: integration?.scan ?? false,
    setup: integration?.setup ?? true,
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
    try {
      integrations.set(packageName, resolveAxeIntegrationPackage(root, packageName));
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
