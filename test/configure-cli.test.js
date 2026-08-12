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
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function run(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
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
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
    }, null, 2)}\n`,
  );

  const migrateResult = run(root, ['migrate']);
  assert.equal(migrateResult.status, 0, migrateResult.stderr);
  assert.match(migrateResult.stdout, /migration: updated/);

  const enableResult = run(
    root,
    [
      'enable',
      'eslint',
      'prettier',
      'stylelint',
      'styleComplexity',
      'maxFileLines',
      'architecture',
      'build',
      'typeCheck',
      'unitTest',
      'coverage',
      'lighthouse',
    ],
  );
  assert.equal(enableResult.status, 0, enableResult.stderr);
  assert.match(enableResult.stdout, /eslint: enabled/);
  assert.match(enableResult.stdout, /prettier: enabled/);
  assert.match(enableResult.stdout, /stylelint: enabled/);
  assert.match(enableResult.stdout, /styleComplexity: enabled/);
  assert.match(enableResult.stdout, /lighthouse: enabled/);
  assert.match(enableResult.stdout, /maxFileLines: enabled/);
  assert.match(enableResult.stdout, /architecture: enabled/);
  assert.match(enableResult.stdout, /build: enabled/);
  assert.match(enableResult.stdout, /typeCheck: enabled/);
  assert.match(enableResult.stdout, /unitTest: enabled/);
  assert.match(enableResult.stdout, /coverage: enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.prettier.enabled, true);
  assert.equal(config.preCommit.stylelint.enabled, true);
  assert.equal(config.preCommit.stylelint.complexity.enabled, true);
  assert.equal(config.preCommit.stylelint.complexity.enabled, true);
  assert.equal(config.lighthouse.enabled, true);
  assert.equal(config.preCommit.maxFileLines.enabled, true);
  assert.equal(config.architecture.enabled, true);
  assert.equal(config.build.enabled, true);
  assert.equal(config.typeCheck.enabled, true);
  assert.equal(config.unitTest.enabled, true);
  assert.equal(config.unitTest.coverage.enabled, true);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:unit-test-policy:start/,
  );
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:architecture-policy:start/,
  );

  const disableResult = run(root, ['disable', 'notification']);
  assert.equal(disableResult.status, 0, disableResult.stderr);
  assert.match(disableResult.stdout, /notification: disabled/);
  const disabledConfig = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(disabledConfig.notification.enabled, false);
});

test('init enables Stylelint when the project already provides it and a config', (context) => {
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
  assert.match(initResult.stdout, /Stylelint .* enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.preCommit.stylelint.enabled, true);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:exception-policy:start/,
  );
});

test('init enables build when the project script is ready', (context) => {
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
  assert.match(initResult.stdout, /Build: enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.build.enabled, true);
});

test('init enables unit tests and writes AI policy when Vitest is ready', (context) => {
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
  assert.match(initResult.stdout, /Unit tests: enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.unitTest.enabled, true);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:unit-test-policy:start/,
  );
});

test('init enables TypeScript when the typecheck script is ready', (context) => {
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
  assert.match(initResult.stdout, /TypeScript: enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.typeCheck.enabled, true);
});

test('init enables architecture and writes AI policy when dependency-cruiser is ready', (context) => {
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
  assert.match(initResult.stdout, /Architecture: enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.architecture.enabled, true);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:architecture-policy:start/,
  );
});
