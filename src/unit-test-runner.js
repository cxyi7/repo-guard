import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { DEFAULT_UNIT_TEST_CONFIG, normalizeGitPath } from './config.js';
import {
  buildCoverageArguments,
  formatCoverageReport,
  inspectCoverageReports,
  isCoverageEnabled,
  isStructuredCoverage,
  prepareCoverageReports,
} from './coverage-runner.js';
import { changeSetEntries } from './core/capability/gate-context.js';
import { runGit } from './git.js';
import { collectProjectFiles } from './file-placement.js';
import { resolveProjectPackageMetadata } from './project-package.js';
import {
  analyzeVueComponentInteractionTest,
  findVueInteractionEntries,
} from './vue-component-interaction.js';

const TEST_API_BASE_PATTERN = /(?<![\w$.])\b(describe|it|test)\b/g;
const DISABLED_TEST_PROPERTIES = new Set(['only', 'skip', 'skipIf', 'todo']);
const EXECUTING_TEST_PROPERTIES = new Set([
  'concurrent',
  'each',
  'fails',
  'for',
  'runIf',
  'sequential',
]);

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw new Error(`package.json was not found in repository root: ${root}`);
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateUnitTestSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(
      `Unit test gate requires package.json script "${config.script}"`,
    );
  }
  const vitest = resolveProjectPackageMetadata(root, 'vitest', 'Vitest');
  const vueTestUtils = config.componentInteraction.enabled
    ? resolveProjectPackageMetadata(root, '@vue/test-utils', 'Vue Test Utils')
    : null;
  return { command: command.trim(), vitest, vueTestUtils };
}

export function detectProjectUnitTestSetup(root, config) {
  try {
    return { ready: true, setup: validateUnitTestSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}

function matches(pathname, patterns) {
  return micromatch.isMatch(pathname, patterns, { dot: true });
}

function isDeleted(change) {
  return change.status.startsWith('D');
}

function isNew(change) {
  return change.status === '??'
    || change.status.startsWith('A')
    || change.status.startsWith('C');
}

function requiresTest(change, mode) {
  return mode === 'changedFiles' ? !isDeleted(change) : isNew(change);
}

export function expectedUnitTestPaths(
  sourcePath,
  mappings = DEFAULT_UNIT_TEST_CONFIG.mappings,
) {
  const normalizedSource = normalizeGitPath(sourcePath);
  const mapping = mappings.find(({ sourcePattern }) => (
    matches(normalizedSource, [sourcePattern])
  ));
  if (!mapping) {
    throw new Error(
      `Unit test source mapping was not found for: ${normalizedSource}.`,
    );
  }

  const parsed = path.posix.parse(normalizedSource);
  const variables = {
    dir: parsed.dir || '.',
    ext: parsed.ext.replace(/^\./, ''),
    name: parsed.name,
    path: path.posix.join(parsed.dir, parsed.name),
  };
  return [...new Set(mapping.testTemplates.map((template) => (
    normalizeGitPath(path.posix.normalize(template.replace(
      /\{(dir|ext|name|path)\}/g,
      (_, key) => variables[key],
    )))
  )))];
}

export function expectedUnitTestPath(sourcePath) {
  return expectedUnitTestPaths(sourcePath)[0];
}

function previousNonWhitespace(value) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(value[index])) {
      return value[index];
    }
  }
  return '';
}

function masksRegexLiteral(output) {
  const previous = previousNonWhitespace(output);
  if (!previous || /[([{:,;=!?&|+\-*%^~<>]/.test(previous)) {
    return true;
  }
  let index = output.length - 1;
  while (index >= 0 && /\s/.test(output[index])) {
    index -= 1;
  }
  let word = '';
  while (index >= 0 && /[\w$]/.test(output[index])) {
    word = output[index] + word;
    index -= 1;
  }
  return new Set([
    'await',
    'case',
    'delete',
    'in',
    'instanceof',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]).has(word);
}

function maskNonCode(content) {
  const output = [];
  let state = 'code';
  let stringQuote = '';
  let inCharacterClass = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    const masked = character === '\n' || character === '\r' ? character : ' ';

    if (state === 'line-comment') {
      output.push(masked);
      if (character === '\n') {
        state = 'code';
      }
      continue;
    }
    if (state === 'block-comment') {
      output.push(masked);
      if (character === '*' && next === '/') {
        output.push(' ');
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'string' || state === 'template') {
      output.push(masked);
      if (character === '\\') {
        if (next != null) {
          output.push(next === '\n' || next === '\r' ? next : ' ');
          index += 1;
        }
        continue;
      }
      if (
        (state === 'string' && character === stringQuote)
        || (state === 'template' && character === '`')
      ) {
        state = 'code';
      }
      continue;
    }
    if (state === 'regex') {
      output.push(masked);
      if (character === '\\') {
        if (next != null) {
          output.push(' ');
          index += 1;
        }
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
      } else if (character === ']') {
        inCharacterClass = false;
      } else if (character === '/' && !inCharacterClass) {
        state = 'regex-flags';
      }
      continue;
    }
    if (state === 'regex-flags') {
      if (/[A-Za-z]/.test(character)) {
        output.push(' ');
        continue;
      }
      state = 'code';
    }

    if (character === '/' && next === '/') {
      output.push(' ', ' ');
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      output.push(' ', ' ');
      index += 1;
      state = 'block-comment';
    } else if (character === '/' && masksRegexLiteral(output)) {
      output.push(' ');
      state = 'regex';
      inCharacterClass = false;
    } else if (character === "'" || character === '"') {
      output.push(' ');
      state = 'string';
      stringQuote = character;
    } else if (character === '`') {
      output.push(' ');
      state = 'template';
    } else {
      output.push(character);
    }
  }

  return output.join('');
}

export function analyzeUnitTestContent(content) {
  const code = maskNonCode(content);
  const bypasses = [];
  let hasTestCase = false;

  for (const match of code.matchAll(TEST_API_BASE_PATTERN)) {
    const base = match[1];
    const properties = [];
    let cursor = match.index + match[0].length;
    let hasCall = false;

    while (cursor < code.length) {
      while (cursor < code.length && /\s/.test(code[cursor])) {
        cursor += 1;
      }
      if (code[cursor] === '.') {
        cursor += 1;
        while (cursor < code.length && /\s/.test(code[cursor])) {
          cursor += 1;
        }
        const propertyStart = cursor;
        if (cursor >= code.length || !/[A-Za-z_$]/.test(code[cursor])) {
          break;
        }
        cursor += 1;
        while (cursor < code.length && /[\w$]/.test(code[cursor])) {
          cursor += 1;
        }
        properties.push({
          index: propertyStart,
          name: code.slice(propertyStart, cursor),
        });
        continue;
      }
      if (code[cursor] === '(') {
        hasCall = true;
        let depth = 1;
        cursor += 1;
        while (cursor < code.length && depth > 0) {
          if (code[cursor] === '(') {
            depth += 1;
          } else if (code[cursor] === ')') {
            depth -= 1;
          }
          cursor += 1;
        }
        continue;
      }
      break;
    }

    if (!hasCall) {
      continue;
    }
    const knownProperties = properties.every(({ name }) => (
      EXECUTING_TEST_PROPERTIES.has(name)
      || DISABLED_TEST_PROPERTIES.has(name)
    ));
    if (base !== 'describe' && knownProperties) {
      hasTestCase = true;
    }
    for (const property of properties) {
      if (!DISABLED_TEST_PROPERTIES.has(property.name)) {
        continue;
      }
      const line = code.slice(0, property.index).split(/\r?\n/).length;
      bypasses.push({ line, expression: `${base}.${property.name}` });
    }
  }

  return { bypasses, hasTestCase };
}

function readPolicyFile(root, filePath, headSha) {
  if (headSha) {
    try {
      return runGit(['show', `${headSha}:${filePath}`], { cwd: root }).stdout;
    } catch {
      return null;
    }
  }
  const absolute = path.join(root, filePath);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

function interactionSourceChanges(root, changes, config) {
  if (!config.componentInteraction.enabled) return [];
  const sourceChanges = new Map();
  for (const change of changes) {
    if (!isDeleted(change)
      && change.path.toLowerCase().endsWith('.vue')
      && matches(change.path, config.componentInteraction.componentPatterns)
      && matches(change.path, config.sourcePatterns)
      && !matches(change.path, config.exclusions)) {
      sourceChanges.set(`${change.headSha ?? ''}\0${change.path}`, change);
    }
  }
  for (const change of changes) {
    if (isDeleted(change) || !matches(change.path, config.testPatterns)) continue;
    const projectFiles = change.headSha
      ? runGit(
        ['ls-tree', '-r', '--name-only', change.headSha],
        { cwd: root },
      ).stdout.split(/\r?\n/).filter(Boolean)
      : collectProjectFiles(root);
    for (const sourcePath of projectFiles) {
      if (!sourcePath.toLowerCase().endsWith('.vue')
        || !matches(sourcePath, config.componentInteraction.componentPatterns)
        || !matches(sourcePath, config.sourcePatterns)
        || matches(sourcePath, config.exclusions)
        || !expectedUnitTestPaths(sourcePath, config.mappings).includes(change.path)) {
        continue;
      }
      sourceChanges.set(`${change.headSha ?? ''}\0${sourcePath}`, {
        ...change,
        path: sourcePath,
      });
    }
  }
  return [...sourceChanges.values()];
}

function inspectComponentInteractions({ root, changes, config }) {
  const issues = [];
  for (const change of interactionSourceChanges(root, changes, config)) {
    const sourcePath = change.path;
    const componentSource = readPolicyFile(root, sourcePath, change.headSha);
    const entries = componentSource == null
      ? []
      : findVueInteractionEntries(componentSource, sourcePath);
    if (entries.length === 0) continue;
    const tests = expectedUnitTestPaths(sourcePath, config.mappings)
      .map((testPath) => ({
        content: readPolicyFile(root, testPath, change.headSha),
        testPath,
      }))
      .filter(({ content }) => content != null && analyzeUnitTestContent(content).hasTestCase);
    if (tests.length === 0) continue;
    const analyses = tests.map(({ content, testPath }) => ({
      ...analyzeVueComponentInteractionTest({
        componentSourcePath: sourcePath,
        testPath,
        testSource: content,
      }),
      testPath,
    }));
    if (!analyses.some(({ valid }) => valid)) {
      issues.push({
        analyses,
        entries,
        sourcePath,
        testPaths: tests.map(({ testPath }) => testPath),
      });
    }
  }
  return issues;
}

export function inspectUnitTestPolicy({ root, changes, config }) {
  changes = changeSetEntries(changes, 'Unit test policy changes');
  const missingTests = [];
  const bypasses = [];

  for (const change of changes) {
    const filePath = change.path;
    if (
      isDeleted(change)
      || matches(filePath, config.exclusions)
      || matches(filePath, config.testPatterns)
      || !matches(filePath, config.sourcePatterns)
      || !requiresTest(change, config.requireTests)
    ) {
      continue;
    }
    const expectedPaths = expectedUnitTestPaths(filePath, config.mappings);
    const existingTests = expectedPaths
      .map((testPath) => ({
        content: readPolicyFile(root, testPath, change.headSha),
        testPath,
      }))
      .filter(({ content }) => content != null);
    const effectiveTests = existingTests.filter(({ content }) => (
      analyzeUnitTestContent(content).hasTestCase
    ));
    if (existingTests.length === 0) {
      missingTests.push({
        sourcePath: filePath,
        expectedTestPath: expectedPaths[0],
        expectedTestPaths: expectedPaths,
        reason: 'missing',
      });
    } else if (effectiveTests.length === 0) {
      missingTests.push({
        sourcePath: filePath,
        expectedTestPath: existingTests[0].testPath,
        expectedTestPaths: expectedPaths,
        reason: 'empty',
      });
    }
  }

  for (const change of changes) {
    if (isDeleted(change) || !matches(change.path, config.testPatterns)) {
      continue;
    }
    const content = readPolicyFile(root, change.path, change.headSha);
    if (content == null) {
      continue;
    }
    const analysis = analyzeUnitTestContent(content);
    if (
      !analysis.hasTestCase
      && !missingTests.some(({ expectedTestPath }) => expectedTestPath === change.path)
    ) {
      missingTests.push({
        sourcePath: null,
        expectedTestPath: change.path,
        reason: 'empty',
      });
    }
    for (const bypass of analysis.bypasses) {
      bypasses.push({ filePath: change.path, ...bypass });
    }
  }

  return {
    bypasses,
    componentInteractions: inspectComponentInteractions({ root, changes, config }),
    missingTests,
  };
}

export function buildUnitTestAiInstructions({
  bypasses,
  componentInteractions = [],
  missingTests,
  script = 'test:unit',
}) {
  const lines = ['单元测试门禁失败，可将以下指令交给 AI 修复：'];
  let index = 1;
  for (const missing of missingTests) {
    const action = missing.reason === 'empty'
      ? `请补全 ${missing.expectedTestPath} 中的有效单元测试。`
      : `请为 ${missing.sourcePath} 新增单元测试。`;
    lines.push(
      '',
      `${index}. ${action}`,
      `   预期文件：${missing.expectedTestPath}`,
      ...(missing.expectedTestPaths?.length > 1
        ? [`   允许位置：${missing.expectedTestPaths.join('、')}`]
        : []),
      '   覆盖要求：测试公开输入输出、正常路径、边界条件和失败路径；Bug 修复需包含回归用例。',
      '   Vue 组件应验证 Props、用户交互、渲染结果和 emit；API 必须 Mock 网络。',
      '   禁止绕过：不要修改门禁、加入 exclusions、创建空测试或删除必要断言。',
      `   完成后运行 npm run ${script}。`,
    );
    index += 1;
  }
  for (const bypass of bypasses) {
    lines.push(
      '',
      `${index}. 请移除 ${bypass.filePath} 第 ${bypass.line} 行的测试绕过：${bypass.expression}`,
      '   修复或补全该测试，使其正常参与执行；不得改用其他 skip/only 形式规避。',
      `   完成后运行 npm run ${script}。`,
    );
    index += 1;
  }
  for (const issue of componentInteractions) {
    const best = issue.analyses.reduce((current, candidate) => {
      const score = Number(candidate.componentImport)
        + Number(candidate.mount)
        + Number(candidate.interaction)
        + Number(candidate.assertion);
      return !current || score > current.score ? { ...candidate, score } : current;
    }, null);
    const missing = [
      ...(!best?.componentImport ? ['直接导入被测 Vue 组件'] : []),
      ...(!best?.mount ? ['使用 @vue/test-utils 的 mount 真实挂载该组件'] : []),
      ...(!best?.interaction ? ['通过 wrapper.trigger/setValue/setChecked/setSelected 执行用户交互'] : []),
      ...(!best?.assertion ? ['在交互后断言 DOM、可见状态、emit、Props、路由、Store 或 Mock 调用结果'] : []),
    ];
    lines.push(
      '',
      `${index}. 请为 ${issue.sourcePath} 补全 Vue 组件交互测试。`,
      `   交互入口：${issue.entries.map(({ name }) => name).join('、')}。`,
      `   当前测试：${issue.testPaths.join('、')}。`,
      `   缺少步骤：${missing.join('；')}。`,
      '   测试要求：在同一个正常执行的 it/test 用例中，依次完成组件导入、mount、真实用户交互和交互结果断言。',
      '   结果断言：优先验证用户可见 DOM/状态或组件 emit；涉及路由、Store、定时器或外部回调时，验证对应状态或 Mock 调用参数。',
      '   禁止弱测试：仅断言组件已定义、wrapper.exists()、mount 不抛错、快照或交互前初始状态不能替代交互结果断言。',
      '   禁止绕过：不得删除模板交互、改成动态写法、关闭 componentInteraction、扩大 componentPatterns/exclusions，或使用 skip/only/todo。',
      `   完成后运行 npm run ${script}，并确认组件交互、普通单元测试和覆盖率门禁全部通过。`,
    );
    index += 1;
  }
  lines.push('', '提交或推送已停止。');
  return lines.join('\n');
}

function runNpmScript(root, config) {
  const scriptArgs = ['run', config.script];
  const coverageArgs = buildCoverageArguments(config);
  if (coverageArgs.length > 0) {
    scriptArgs.push('--', ...coverageArgs);
  }
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${scriptArgs.map((argument) => (
      /[\s&|<>^()]/.test(argument) ? `"${argument.replaceAll('"', '""')}"` : argument
    )).join(' ')}`]
    : scriptArgs;
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}

export function runUnitTestGate({ root, config, changes }) {
  changeSetEntries(changes, 'Unit test gate changes');
  const setup = validateUnitTestSetup(root, config);
  const policy = inspectUnitTestPolicy({ root, changes, config });
  if (policy.missingTests.length > 0
    || policy.bypasses.length > 0
    || policy.componentInteractions.length > 0) {
    console.error(buildUnitTestAiInstructions({
      ...policy,
      script: config.script,
    }));
    return 1;
  }

  console.log(
    `repo-guard unit tests: Vitest ${setup.vitest.version}, `
    + `running npm script "${config.script}"`
    + `${isCoverageEnabled(config.coverage) ? ' with coverage' : ''}...`,
  );
  prepareCoverageReports(root, config.coverage);
  const result = runNpmScript(root, config);
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      console.error(`单元测试超过 ${config.timeoutMs}ms，推送已停止。`);
      return 1;
    }
    throw new Error(`Unable to run unit tests: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error([
      `单元测试失败（退出码 ${result.status ?? 1}），推送已停止。`,
      '请根据上方 Vitest 输出修复根因和对应代码或测试。',
      '不得删除失败测试、降低必要断言、使用 .skip/.skipIf/.todo/.only 或修改门禁绕过。',
      `修复后重新运行 npm run ${config.script}。`,
    ].join('\n'));
    return result.status ?? 1;
  }
  if (isStructuredCoverage(config.coverage)) {
    let coverageResult;
    try {
      coverageResult = inspectCoverageReports({ root, config, changes });
    } catch (error) {
      console.error([
        `Coverage gate failed: ${error.message}`,
        'Ensure the configured Vitest coverage provider can generate json-summary and lcov reports.',
        'Do not reuse stale reports, disable the gate, or reduce thresholds to bypass the failure.',
      ].join('\n'));
      return 1;
    }
    const report = formatCoverageReport(coverageResult, root);
    console.log(report);
    if (!coverageResult.passed) {
      console.error([
        'Coverage or changed-line coverage is below the configured hard threshold.',
        'Add effective tests for the uncovered behavior and changed lines, then run the unit-test gate again.',
        'Do not exclude production files or reduce thresholds to bypass the gate.',
      ].join('\n'));
      return 1;
    }
  }
  console.log('repo-guard unit tests passed.');
  return 0;
}
