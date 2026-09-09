import { parseProjectFixture } from '../helpers/project-config.js';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function run(root, args) {
  const projectOptions = ['init', 'migrate'].includes(args[0])
    ? ['--project', 'web', '--role', 'frontend', '--stack', 'node', '--preset', 'vue-javascript'] : [];
  return spawnSync(process.execPath, [CLI_PATH, ...args, ...projectOptions], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('CLI migrates configuration and enables selected gates', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-cli-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      preCommit: {
        eslint: { enabled: false },
        prettier: { enabled: false },
        maxFileLines: { enabled: false },
      },
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
    }, null, 2)}\n`,
  );

  const migrateResult = run(root, ['migrate']);
  assert.equal(migrateResult.status, 0, migrateResult.stderr);
  assert.match(migrateResult.stdout, /迁移：已更新/);

  const enableResult = run(
    root,
    [
      'enable',
      'eslint',
      'prettier',
      'stylelint',
      'styleComplexity',
      'styleGovernance',
      'functionDocs',
      'maxFileLines',
      'architecture',
      'build',
      'typeCheck',
      'unitTest',
      'componentInteraction',
      'accessibilityTest',
      'coverage',
      'lighthouse',
    ],
  );
  assert.equal(enableResult.status, 0, enableResult.stderr);
  assert.match(enableResult.stdout, /eslint: 已启用/);
  assert.match(enableResult.stdout, /prettier: 已启用/);
  assert.match(enableResult.stdout, /stylelint: 已启用/);
  assert.match(enableResult.stdout, /styleComplexity: 已启用/);
  assert.match(enableResult.stdout, /styleGovernance: 已启用/);
  assert.match(enableResult.stdout, /functionDocs: 已启用/);
  assert.match(enableResult.stdout, /lighthouse: 已启用/);
  assert.match(enableResult.stdout, /maxFileLines: 已启用/);
  assert.match(enableResult.stdout, /architecture: 已启用/);
  assert.match(enableResult.stdout, /build: 已启用/);
  assert.match(enableResult.stdout, /typeCheck: 已启用/);
  assert.match(enableResult.stdout, /unitTest: 已启用/);
  assert.match(enableResult.stdout, /componentInteraction: 已启用/);
  assert.match(enableResult.stdout, /accessibilityTest: 已启用/);
  assert.match(enableResult.stdout, /coverage: 已启用/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.prettier.enabled, true);
  assert.equal(config.preCommit.stylelint.enabled, true);
  assert.equal(config.preCommit.stylelint.complexity.enabled, true);
  assert.equal(config.preCommit.stylelint.governance.enabled, true);
  assert.equal(config.preCommit.functionDocs.enabled, true);
  assert.equal(config.lighthouse.enabled, true);
  assert.equal(config.preCommit.maxFileLines.enabled, true);
  assert.equal(config.architecture.enabled, true);
  assert.equal(config.build.enabled, true);
  assert.equal(config.typeCheck.enabled, true);
  assert.equal(config.unitTest.enabled, true);
  assert.equal(config.unitTest.componentInteraction.enabled, true);
  assert.equal(config.accessibilityTest.enabled, true);
  assert.equal(config.unitTest.coverage.enabled, true);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:testing-policy:start/,
  );
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:dependency-health-policy:start/,
  );
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /axe 可访问性测试使用 npm 脚本/,
  );

  const disableResult = run(root, ['disable', 'notification']);
  assert.equal(disableResult.status, 0, disableResult.stderr);
  assert.match(disableResult.stdout, /notification: 已禁用/);
  const disabledConfig = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(disabledConfig.notification.enabled, false);
});

test('初始化显式前端身份，不因已有 Stylelint 配置自动启用检查', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-init-stylelint-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'stylelint.config.mjs'),
    'export default { rules: { "property-no-unknown": true } };\n',
  );

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.preCommit.stylelint.enabled, false);
  assert.equal(config.preCommit.stylelint.governance.enabled, false);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:repository-governance-policy:start/,
  );
});

test('初始化不因已有 build 脚本自动启用构建门禁', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-init-build-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      scripts: { build: 'vite build' },
    }, null, 2)}\n`,
  );

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.build.enabled, false);
});

test('初始化不因已有 Vitest 自动启用单元测试', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-init-unit-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      scripts: { 'test:unit': 'vitest run' },
    }, null, 2)}\n`,
  );
  const vitestRoot = path.join(root, 'node_modules', 'vitest');
  mkdirSync(vitestRoot, { recursive: true });
  writeFileSync(
    path.join(vitestRoot, 'package.json'),
    `${JSON.stringify({ name: 'vitest', version: '3.2.4', main: 'index.js' }, null, 2)}\n`,
  );
  writeFileSync(path.join(vitestRoot, 'index.js'), 'export default {};\n');

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.unitTest.enabled, false);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:testing-policy:start/,
  );
});

test('初始化不因已有 typecheck 脚本自动启用类型检查', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-init-typecheck-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      scripts: { typecheck: 'tsc --noEmit' },
    }, null, 2)}\n`,
  );

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.typeCheck.enabled, false);
});

test('初始化不因已有 dependency-cruiser 自动启用架构检查', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-init-architecture-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  mkdirSync(path.join(root, 'src'));
  const dependencyRoot = path.join(root, 'node_modules', 'dependency-cruiser');
  mkdirSync(path.join(dependencyRoot, 'bin'), { recursive: true });
  writeFileSync(
    path.join(dependencyRoot, 'package.json'),
    `${JSON.stringify({
      name: 'dependency-cruiser',
      version: '16.10.4',
      main: 'index.js',
      bin: { depcruise: 'bin/dependency-cruise.mjs' },
    }, null, 2)}\n`,
  );
  writeFileSync(path.join(dependencyRoot, 'index.js'), 'module.exports = {};\n');
  writeFileSync(path.join(dependencyRoot, 'bin', 'dependency-cruise.mjs'), '\n');

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.architecture.enabled, false);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:dependency-health-policy:start/,
  );
});
