import { parseProjectFixture } from '../helpers/project-config.js';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(
  new URL('../../bin/repo-guard.js', import.meta.url),
);
mkdirSync(TEST_ROOT, { recursive: true });

function run(root, args) {
  const projectOptions = args[0] === 'init'
    ? [
        '--project',
        'web',
        '--role',
        'frontend',
        '--stack',
        'node',
        '--preset',
        'vue-javascript',
      ]
    : [];
  return spawnSync(process.execPath, [CLI_PATH, ...args, ...projectOptions], {
    cwd: root,
    encoding: 'utf8',
  });
}

for (const profile of ['full', 'release-ready']) {
  test(`CLI install-ci 省略配置档时保留 ${profile}，只在显式指定时覆盖`, (context) => {
    const root = mkdtempSync(path.join(TEST_ROOT, 'install-ci-profile-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    assert.equal(gitResult.status, 0, gitResult.stderr);
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    const configPath = path.join(root, 'repo-guard.config.json');
    const original = `${JSON.stringify({
      version: 2,
      project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' },
      ci: { enabled: true, profile },
    }, null, 2)}\n`;
    writeFileSync(configPath, original);

    const preview = run(root, ['install-ci', '--provider', 'gitlab', '--dry-run']);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, new RegExp(`配置档： ${profile}`));
    assert.equal(readFileSync(configPath, 'utf8'), original);
    assert.equal(existsSync(path.join(root, '.gitlab-ci.yml')), false);

    const installed = run(root, ['install-ci', '--provider', 'gitlab']);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).ci.profile, profile);
    assert.match(
      readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8'),
      new RegExp(`extends: \\.repo_guard_${profile.replaceAll('-', '_')}`),
    );

    const overridden = run(root, ['install-ci', '--provider', 'gitlab', '--profile', 'policy']);
    assert.equal(overridden.status, 0, overridden.stderr);
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).ci.profile, 'policy');
    assert.match(readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8'), /extends: \.repo_guard_policy/);
  });
}

test('CLI 不再提供 migrate 命令，拒绝后保持用户文件不变', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'unsupported-migrate-cli-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const originals = {
    'repo-guard.config.json': '\uFEFF{"version":1,"rules":[]}\r\n',
    'package.json': '{"name":"fixture","scripts":{"custom":"node custom.js"}}\n',
    'AGENTS.md': '人工维护的规范\n',
    'repo-guard.ops.json': '{"version":2,"enabled":false}\n',
  };
  for (const [name, content] of Object.entries(originals)) {
    writeFileSync(path.join(root, name), content);
  }
  const result = run(root, ['migrate']);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /未知命令： migrate/);
  for (const [name, content] of Object.entries(originals)) {
    assert.equal(readFileSync(path.join(root, name), 'utf8'), content);
  }
  for (const name of ['repo-guard.config.v1.backup.json', 'repo-guard.migration.json', '.agents']) {
    assert.equal(existsSync(path.join(root, name)), false);
  }
  const help = run(root, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /repo-guard migrate/);
});

test('CLI 初始化和启停遇到旧配置均拒绝，不产生托管附属文件', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'unsupported-v1-cli-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  const originals = {
    'repo-guard.config.json': '{"version":1,"rules":[]}\r\n',
    'package.json': '{"name":"fixture","version":"1.0.0"}\n',
    'AGENTS.md': '人工维护的规范\n',
  };
  for (const [name, content] of Object.entries(originals)) {
    writeFileSync(path.join(root, name), content);
  }
  for (const args of [['init'], ['enable', 'eslint'], ['disable', 'eslint']]) {
    const result = run(root, args);
    assert.equal(result.status, 1, result.stdout);
    assert.match(`${result.stdout}${result.stderr}`, /仅支持 version: 2|v2/);
    for (const [name, content] of Object.entries(originals)) {
      assert.equal(readFileSync(path.join(root, name), 'utf8'), content);
    }
    for (const name of ['repo-guard.ops.json', '.agents', 'repo-guard.config.v1.backup.json', 'repo-guard.migration.json']) {
      assert.equal(existsSync(path.join(root, name)), false);
    }
  }
});

test('CLI 初始化 v2 后启用选定检查并同步规范', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-cli-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(Object.hasOwn(packageJson.scripts, 'guard:migrate'), false);

  const initialDisable = run(root, ['disable', 'eslint', 'prettier', 'maxFileLines']);
  assert.equal(initialDisable.status, 0, initialDisable.stderr);

  const enableResult = run(root, [
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
  ]);
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
  assert.equal(config.checks.eslint.enabled, true);
  assert.equal(config.checks.prettier.enabled, true);
  assert.equal(config.checks.stylelint.enabled, true);
  assert.equal(config.checks.styleComplexity.enabled, true);
  assert.equal(config.checks.styleGovernance.enabled, true);
  assert.equal(config.checks.functionDocs.enabled, true);
  assert.equal(config.checks.lighthouse.enabled, true);
  assert.equal(config.checks.maxFileLines.enabled, true);
  assert.equal(config.checks.architecture.enabled, true);
  assert.equal(config.checks.build.enabled, true);
  assert.equal(config.checks.typeCheck.enabled, true);
  assert.equal(config.checks.unitTest.enabled, true);
  assert.equal(config.checks.componentInteraction.enabled, true);
  assert.equal(config.checks.accessibilityTest.enabled, true);
  assert.equal(config.checks.coverage.enabled, true);
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
  assert.equal(disabledConfig.reporting.notification.enabled, false);
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
  assert.equal(config.checks.stylelint.enabled, false);
  assert.equal(config.checks.styleGovernance.enabled, false);
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
    `${JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        scripts: { build: 'vite build' },
      },
      null,
      2,
    )}\n`,
  );

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.checks.build.enabled, false);
});

test('初始化不因已有 Vitest 自动启用单元测试', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'configure-init-unit-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        scripts: { 'test:unit': 'vitest run' },
      },
      null,
      2,
    )}\n`,
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
  assert.equal(config.checks.unitTest.enabled, false);
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
    `${JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        scripts: { typecheck: 'tsc --noEmit' },
      },
      null,
      2,
    )}\n`,
  );

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.checks.typeCheck.enabled, false);
});

test('初始化不因已有 dependency-cruiser 自动启用架构检查', (context) => {
  const root = mkdtempSync(
    path.join(TEST_ROOT, 'configure-init-architecture-'),
  );
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
    `${JSON.stringify(
      {
        name: 'dependency-cruiser',
        version: '16.10.4',
        main: 'index.js',
        bin: { depcruise: 'bin/dependency-cruise.mjs' },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(dependencyRoot, 'index.js'),
    'module.exports = {};\n',
  );
  writeFileSync(
    path.join(dependencyRoot, 'bin', 'dependency-cruise.mjs'),
    '\n',
  );

  const initResult = run(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /应用 web：前端，预设 vue-javascript/);

  const config = parseProjectFixture(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.checks.architecture.enabled, false);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:dependency-health-policy:start/,
  );
});
