import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runPrePush } from '../src/orchestration/pre-push/runner.js';
import { runVueLighthouse } from '../src/gates/quality/lighthouse-gate.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitFixture(root, message = 'fixture') {
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function createFixture({ buildEnabled = false, enabled = false, vue = true } = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'lighthouse-'));
  git(root, ['init']);
  mkdirSync(path.join(root, 'node_modules', '@lhci', 'cli', 'src'), { recursive: true });

  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'vue-lighthouse-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node build.mjs' },
      dependencies: vue ? { vue: '^3.5.0' } : {},
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'build.mjs'),
    [
      "import { appendFileSync } from 'node:fs';",
      "appendFileSync(new URL('calls.log', import.meta.url), 'build\\n');",
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'node_modules', '@lhci', 'cli', 'package.json'),
    `${JSON.stringify({
      name: '@lhci/cli',
      version: '0.15.1',
      type: 'module',
      main: './src/cli.js',
      bin: { lhci: './src/cli.js' },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'node_modules', '@lhci', 'cli', 'src', 'cli.js'),
    [
      "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "const phase = process.argv[2];",
      "appendFileSync(path.join(process.cwd(), 'calls.log'), `${phase}\\n`);",
      "const failureFile = path.join(process.cwd(), 'fail-phase');",
      "if (existsSync(failureFile) && readFileSync(failureFile, 'utf8').trim() === phase) {",
      '  process.exitCode = 7;',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'lighthouserc.json'),
    `${JSON.stringify({ ci: { collect: { url: ['http://localhost:4173/'] } } }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      build: { enabled: buildEnabled },
      lighthouse: { enabled },
      notification: { enabled: false },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

function lighthouseConfig() {
  return {
    enabled: false,
    configFile: null,
    buildScript: 'build',
    timeoutMs: 30000,
  };
}

test('builds a Vue project and runs Lighthouse collect then assert', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runVueLighthouse({ root, config: lighthouseConfig() });
  assert.equal(result.status, 'passed');
  assert.equal(result.diagnostics.some(({ message }) => message.includes('vue-lighthouse-fixture')), true);
  assert.equal(readFileSync(path.join(root, 'calls.log'), 'utf8'), 'build\ncollect\nassert\n');
});

test('supports skipping the Vue build for an already running project', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(runVueLighthouse({
    root,
    config: lighthouseConfig(),
    skipBuild: true,
  }).status, 'passed');
  assert.equal(readFileSync(path.join(root, 'calls.log'), 'utf8'), 'collect\nassert\n');
});

test('exposes the Vue Lighthouse runner through the CLI', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, 'lighthouse', '--skip-build'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS {2}lighthouse/);
  assert.equal(readFileSync(path.join(root, 'calls.log'), 'utf8'), 'collect\nassert\n');
});

test('stops before assertions when Lighthouse collection fails', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'fail-phase'), 'collect\n');

  assert.equal(runVueLighthouse({ root, config: lighthouseConfig() }).status, 'execution-error');
  assert.equal(readFileSync(path.join(root, 'calls.log'), 'utf8'), 'build\ncollect\n');
});

test('rejects non-Vue projects before running Lighthouse', (context) => {
  const root = createFixture({ vue: false });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => runVueLighthouse({ root, config: lighthouseConfig() }),
    /requires a Vue project/,
  );
});

test('requires the Vue project to provide a Lighthouse config', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  rmSync(path.join(root, 'lighthouserc.json'));

  assert.throws(
    () => runVueLighthouse({ root, config: lighthouseConfig() }),
    /configuration was not found/,
  );
});

test('pre-push only runs Lighthouse when enabled', async (context) => {
  const disabledRoot = createFixture();
  const enabledRoot = createFixture({ enabled: true });
  context.after(() => {
    rmSync(disabledRoot, { recursive: true, force: true });
    rmSync(enabledRoot, { recursive: true, force: true });
  });
  commitFixture(disabledRoot);
  commitFixture(enabledRoot);

  assert.equal(await runPrePush(disabledRoot), 0);
  assert.equal(readFileSync(path.join(disabledRoot, 'calls.log'), { flag: 'a+', encoding: 'utf8' }), '');
  assert.equal(await runPrePush(enabledRoot), 0);
  assert.equal(
    readFileSync(path.join(enabledRoot, 'calls.log'), 'utf8'),
    'build\ncollect\nassert\n',
  );
});

test('pre-push reuses an enabled independent build for Lighthouse', async (context) => {
  const root = createFixture({ buildEnabled: true, enabled: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitFixture(root);

  assert.equal(await runPrePush(root), 0);
  assert.equal(
    readFileSync(path.join(root, 'calls.log'), 'utf8'),
    'build\ncollect\nassert\n',
  );
});

test('pre-push runs enabled gates against a clean pushed HEAD', async (context) => {
  const root = createFixture({ enabled: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const head = commitFixture(root);
  const input = `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`;

  assert.equal(await runPrePush(root, { input }), 0);
  assert.equal(
    readFileSync(path.join(root, 'calls.log'), 'utf8'),
    'build\ncollect\nassert\n',
  );
});

test('pre-push rejects uncommitted configuration that could disable committed gates', async (context) => {
  const root = createFixture({ enabled: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const head = commitFixture(root);
  const configPath = path.join(root, 'repo-guard.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.lighthouse.enabled = false;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const input = `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`;

  await assert.rejects(
    () => runPrePush(root, { input }),
    /require a clean working tree/,
  );
});

test('pre-push rejects non-HEAD and multi-commit pushes when gates are enabled', async (context) => {
  const root = createFixture({ enabled: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const base = commitFixture(root, 'base');
  writeFileSync(path.join(root, 'README.md'), 'next\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'next']);
  const head = git(root, ['rev-parse', 'HEAD']);

  await assert.rejects(
    () => runPrePush(root, {
      input: `refs/heads/base ${base} refs/heads/base ${'0'.repeat(40)}\n`,
    }),
    /currently checked-out HEAD/,
  );
  await assert.rejects(
    () => runPrePush(root, {
      input: [
        `refs/heads/base ${base} refs/heads/base ${'0'.repeat(40)}`,
        `refs/heads/main ${head} refs/heads/main ${base}`,
        '',
      ].join('\n'),
    }),
    /multiple different commits/,
  );
});

test('pre-push skips historical commits that do not contain repo-guard configuration', async (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'pre-push-no-config-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), 'historical\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'historical']);
  const head = git(root, ['rev-parse', 'HEAD']);

  assert.equal(await runPrePush(root, {
    input: `refs/tags/historical ${head} refs/tags/historical ${'0'.repeat(40)}\n`,
  }), 0);
});
