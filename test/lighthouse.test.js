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
import { runPrePush } from '../src/commands/pre-push.js';
import { runVueLighthouse } from '../src/lighthouse-runner.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function createFixture({ enabled = false, vue = true } = {}) {
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

  assert.equal(runVueLighthouse({ root, config: lighthouseConfig() }), 0);
  assert.equal(readFileSync(path.join(root, 'calls.log'), 'utf8'), 'build\ncollect\nassert\n');
});

test('supports skipping the Vue build for an already running project', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(runVueLighthouse({
    root,
    config: lighthouseConfig(),
    skipBuild: true,
  }), 0);
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
  assert.match(result.stdout, /Lighthouse passed/);
  assert.equal(readFileSync(path.join(root, 'calls.log'), 'utf8'), 'collect\nassert\n');
});

test('stops before assertions when Lighthouse collection fails', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'fail-phase'), 'collect\n');

  assert.equal(runVueLighthouse({ root, config: lighthouseConfig() }), 7);
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

test('pre-push only runs Lighthouse when enabled', (context) => {
  const disabledRoot = createFixture();
  const enabledRoot = createFixture({ enabled: true });
  context.after(() => {
    rmSync(disabledRoot, { recursive: true, force: true });
    rmSync(enabledRoot, { recursive: true, force: true });
  });

  assert.equal(runPrePush(disabledRoot), 0);
  assert.equal(readFileSync(path.join(disabledRoot, 'calls.log'), { flag: 'a+', encoding: 'utf8' }), '');
  assert.equal(runPrePush(enabledRoot), 0);
  assert.equal(
    readFileSync(path.join(enabledRoot, 'calls.log'), 'utf8'),
    'build\ncollect\nassert\n',
  );
});
