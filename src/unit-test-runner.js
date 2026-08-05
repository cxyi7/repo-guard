import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { runGit } from './git.js';
import { resolveProjectPackageMetadata } from './project-package.js';

const BYPASS_PATTERN = /\b(?:describe|it|test)\s*\.\s*(?:only|skip)\b/g;
const TEST_CASE_PATTERN = /\b(?:it|test)\s*(?:\.\s*[A-Za-z_$][\w$]*)*\s*\(/;

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
  return { command: command.trim(), vitest };
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

export function expectedUnitTestPath(sourcePath) {
  return sourcePath.replace(/\.(?:js|vue)$/i, '.spec.js');
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

export function inspectUnitTestPolicy({ root, changes, config }) {
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
    const expected = expectedUnitTestPath(filePath);
    const testContent = readPolicyFile(root, expected, change.headSha);
    if (testContent == null) {
      missingTests.push({
        sourcePath: filePath,
        expectedTestPath: expected,
        reason: 'missing',
      });
    } else if (!TEST_CASE_PATTERN.test(testContent)) {
      missingTests.push({
        sourcePath: filePath,
        expectedTestPath: expected,
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
    if (
      !TEST_CASE_PATTERN.test(content)
      && !missingTests.some(({ expectedTestPath }) => expectedTestPath === change.path)
    ) {
      missingTests.push({
        sourcePath: null,
        expectedTestPath: change.path,
        reason: 'empty',
      });
    }
    for (const match of content.matchAll(BYPASS_PATTERN)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      bypasses.push({ filePath: change.path, line, expression: match[0] });
    }
  }

  return { bypasses, missingTests };
}

export function buildUnitTestAiInstructions({
  bypasses,
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
  lines.push('', '提交或推送已停止。');
  return lines.join('\n');
}

function runNpmScript(root, config) {
  const scriptArgs = ['run', config.script];
  if (config.coverage) {
    scriptArgs.push('--', '--coverage');
  }
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${scriptArgs.join(' ')}`]
    : scriptArgs;
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}

export function runUnitTestGate({ root, config, changes = [] }) {
  const setup = validateUnitTestSetup(root, config);
  const policy = inspectUnitTestPolicy({ root, changes, config });
  if (policy.missingTests.length > 0 || policy.bypasses.length > 0) {
    console.error(buildUnitTestAiInstructions({
      ...policy,
      script: config.script,
    }));
    return 1;
  }

  console.log(
    `repo-guard unit tests: Vitest ${setup.vitest.version}, `
    + `running npm script "${config.script}"${config.coverage ? ' with coverage' : ''}...`,
  );
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
      '不得删除失败测试、降低必要断言、使用 .skip/.only 或修改门禁绕过。',
      `修复后重新运行 npm run ${config.script}。`,
    ].join('\n'));
    return result.status ?? 1;
  }
  console.log('repo-guard unit tests passed.');
  return 0;
}
