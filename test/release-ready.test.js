import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCiGate } from '../src/orchestration/ci/runner.js';
import { validateConfig } from '../src/config/configuration-validation.js';
import { createChangeSet, createGateContext } from '../src/core/capability/gate-context.js';
import { createProjectGateRegistry } from '../src/gates/registry.js';
import { releaseEnvironment } from '../src/integrations/npm/release-environment.js';
import { createProjectReleaseReadyPlan } from '../src/orchestration/execution-plans.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function manifest(version = '2.0.0') {
  return {
    name: 'release-fixture',
    version,
    private: false,
    type: 'module',
    scripts: {
      check: 'node --check index.js',
      test: 'node --check index.js',
      'pack:check': 'npm pack --dry-run --json --ignore-scripts',
    },
    exports: {
      '.': './index.js',
      './config.schema.json': './config.schema.json',
    },
    files: ['index.js', 'config.schema.json', 'CHANGELOG.md', 'README.md'],
  };
}

function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'release-ready-'));
  const packageJson = { ...manifest(), ...overrides };
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(path.join(root, 'package-lock.json'), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: packageJson.name, version: packageJson.version } },
  }, null, 2)}\n`);
  writeFileSync(path.join(root, 'index.js'), 'export const ready = true;\n');
  writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${packageJson.version}\n\n- Ready.\n`);
  writeFileSync(path.join(root, 'config.schema.json'), `${JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
  }, null, 2)}\n`);
  return root;
}

function config(externalGates = []) {
  return {
    version: 1,
    build: { enabled: false },
    lighthouse: { enabled: false },
    externalGates,
  };
}

function git(root, argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function context(root, projectConfig) {
  const changes = createChangeSet({ source: 'ci' });
  return createGateContext({
    root,
    environment: 'release-ready',
    config: projectConfig,
    changes,
    files: [],
    artifactDirectory: path.join(root, 'reports'),
  });
}

async function runGate(root, id) {
  const projectConfig = config();
  const gate = createProjectGateRegistry(projectConfig).get(id);
  const gateContext = context(root, projectConfig);
  await gate.inspectSetup(gateContext);
  const plan = await gate.plan(gateContext);
  return await gate.run({ ...gateContext, plan });
}

test('locks release-ready official gates before project external gates', () => {
  const externalGate = {
    id: 'project.contract',
    enabled: true,
    environments: ['release-ready'],
    script: 'test:contract',
    timeoutMs: 1000,
    report: { format: 'repo-guard-json-v1', path: 'reports/contract.json' },
  };
  const projectConfig = config([externalGate]);
  const registry = createProjectGateRegistry(projectConfig);
  const trusted = createProjectReleaseReadyPlan(projectConfig, registry);
  assert.equal(trusted.steps.at(-1).id, 'project.contract');
  assert.equal(
    trusted.steps.findIndex(({ id }) => id === 'project.contract')
      > trusted.steps.findIndex(({ id }) => id === 'release.package'),
    true,
  );
  assert.equal(
    createProjectReleaseReadyPlan(projectConfig, registry, { includeExternalGates: false })
      .steps.some(({ id }) => id === 'project.contract'),
    false,
  );
});

test('rejects publishing from a release-ready external gate', (contextTest) => {
  const root = fixture({
    scripts: {
      check: 'node --check index.js',
      test: 'node --check index.js',
      'pack:check': 'npm pack --dry-run --json --ignore-scripts',
      'test:contract': 'node scripts/publish.js',
    },
  });
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  const externalGate = {
    id: 'project.contract',
    enabled: true,
    environments: ['release-ready'],
    script: 'test:contract',
    timeoutMs: 1000,
    report: { format: 'repo-guard-json-v1', path: 'reports/contract.json' },
  };
  const projectConfig = config([externalGate]);
  assert.throws(
    () => createProjectGateRegistry(projectConfig).get('project.contract')
      .inspectSetup(context(root, projectConfig)),
    /不得执行发布或部署/,
  );
});

test('runs exact check and test scripts with release credentials removed', async (contextTest) => {
  const root = fixture();
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal((await runGate(root, 'release.check')).status, 'passed');
  assert.equal((await runGate(root, 'release.test')).status, 'passed');
  assert.deepEqual(releaseEnvironment({
    PATH: 'safe',
    CI: 'true',
    NPM_TOKEN: 'forbidden',
    DEPLOY_PASSWORD: 'forbidden',
    AWS_ACCESS_KEY_ID: 'forbidden',
  }), {
    PATH: 'safe',
    CI: 'true',
    npm_config_userconfig: process.platform === 'win32' ? 'NUL' : '/dev/null',
  });
});

test('proves package metadata and npm artifacts without creating a tarball', async (contextTest) => {
  const root = fixture();
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await runGate(root, 'release.package');
  assert.equal(result.status, 'passed', result.error?.message);
  assert.equal(result.metrics.schemas, 1);
  assert.equal(result.metrics.violations, 0);
  assert.equal(result.metrics.packedFiles > 0, true);
  assert.equal(readFileSync(path.join(root, 'package.json'), 'utf8').includes('2.0.0'), true);
  assert.equal(readdirSync(root).some((file) => file.endsWith('.tgz')), false);
});

test('reports version, changelog, schema, artifact, and sensitive-file violations', async (contextTest) => {
  const root = fixture({ version: '2.1.0' });
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.version = '2.0.0';
  writeFileSync(path.join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 2.0.0\n');
  writeFileSync(path.join(root, 'config.schema.json'), '{"type":"object"}\n');
  const changedManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  changedManifest.exports['./missing.js'] = './missing.js';
  changedManifest.files.push('npm-token.txt');
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(changedManifest, null, 2)}\n`);
  writeFileSync(path.join(root, 'npm-token.txt'), 'sample\n');

  const result = await runGate(root, 'release.package');
  assert.equal(result.status, 'violation', result.error?.message);
  const rules = result.findings.map(({ ruleId }) => ruleId);
  for (const rule of [
    'release/lockfile-version',
    'release/changelog',
    'release/schema-version',
    'release/artifact-missing',
    'release/sensitive-artifact',
  ]) assert.ok(rules.includes(rule), rule);
});

test('rejects release check and test scripts that publish or deploy', (contextTest) => {
  const root = fixture({
    scripts: { check: 'npm publish', test: 'npm run deploy' },
  });
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  const projectConfig = config();
  const registry = createProjectGateRegistry(projectConfig);
  const gateContext = context(root, projectConfig);
  assert.throws(() => registry.get('release.check').inspectSetup(gateContext), /不得执行发布或部署/);
  assert.throws(() => registry.get('release.test').inspectSetup(gateContext), /不得执行发布或部署/);
});

test('requires the exact side-effect-free pack check contract', (contextTest) => {
  const root = fixture({
    scripts: {
      check: 'node --check index.js',
      test: 'node --test',
      'pack:check': 'npm pack --dry-run --json',
    },
  });
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  const projectConfig = config();
  const gateContext = context(root, projectConfig);
  assert.throws(
    () => createProjectGateRegistry(projectConfig).get('release.package').inspectSetup(gateContext),
    /必须等于 "npm pack --dry-run --json --ignore-scripts"/,
  );
});

test('runs release-ready as a read-only CI profile and records all proof steps', async (contextTest) => {
  const root = fixture();
  contextTest.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'index.js'), 'export const ready = true;\nexport const next = true;\n');
  git(root, ['add', 'index.js']);
  git(root, ['commit', '-m', 'next']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const projectConfig = validateConfig({
    version: 1,
    notification: { enabled: false },
    ci: {
      enabled: true,
      profile: 'release-ready',
      reportPath: 'reports/release-ready.json',
      protectedFiles: { action: 'report' },
    },
    dependencyPolicy: { enabled: false, requireLockfile: false },
    build: { enabled: false },
    lighthouse: { enabled: false },
    preCommit: {
      filePlacement: { enabled: false },
      maxFileLines: { enabled: false },
      eslint: { enabled: false },
      prettier: { enabled: false },
      stylelint: { enabled: false },
    },
    rules: [{ pattern: 'index.js', category: 'Source', level: 'audit' }],
  });
  assert.equal(await runCiGate({
    root,
    config: projectConfig,
    base,
    head,
    env: {},
  }), 0);
  const report = JSON.parse(readFileSync(
    path.join(root, 'reports', 'release-ready.json'),
    'utf8',
  ));
  assert.equal(report.profile, 'release-ready');
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.steps.slice(-5).map(({ name, status }) => ({ name, status })), [
    { name: 'release.check', status: 'passed' },
    { name: 'release.test', status: 'passed' },
    { name: 'build', status: 'skipped' },
    { name: 'quality.lighthouse', status: 'skipped' },
    { name: 'release.package', status: 'passed' },
  ]);
});
