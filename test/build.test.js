import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  runBuildGate,
} from '../src/gates/quality/build-gate.js';
import { detectProjectBuildSetup } from '../src/gates/quality/build-setup.js';
import { validateBuildSetup } from '../src/integrations/npm/build.js';
import { runPrePush } from '../src/orchestration/pre-push/runner.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function commitFixture(root) {
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
}

function buildConfig(extra = {}) {
  return {
    enabled: true,
    script: 'build',
    timeoutMs: 30000,
    ...extra,
  };
}

function createFixture({ enabled = true } = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'build-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'build-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node build.mjs' },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'build.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "appendFileSync('build-calls.log', 'build\\n');",
      "if (existsSync('fail-build')) process.exitCode = 7;",
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      build: { ...buildConfig(), enabled },
      notification: { enabled: false },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('detects and validates the consuming project build script', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(validateBuildSetup(root, buildConfig()), {
    command: 'node build.mjs',
  });
  assert.equal(detectProjectBuildSetup(root, buildConfig()).ready, true);
  assert.throws(
    () => validateBuildSetup(root, buildConfig({ script: 'missing' })),
    /requires package.json script "missing"/,
  );
});

test('runs the consuming project build script and blocks failures', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const passed = runBuildGate({ root, config: buildConfig() });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.diagnostics.some(({ message }) => message.includes('build-fixture')), true);
  writeFileSync(path.join(root, 'fail-build'), 'fail\n');
  const failed = runBuildGate({ root, config: buildConfig() });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.diagnostics.some(({ message }) => message.includes('build-fixture')), true);
  assert.equal(
    readFileSync(path.join(root, 'build-calls.log'), 'utf8'),
    'build\nbuild\n',
  );
});

test('exposes build through CLI and runs it from pre-push', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const cliResult = spawnSync(process.execPath, [CLI_PATH, 'build'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /build passed/);
  commitFixture(root);
  assert.equal(await runPrePush(root), 0);
  assert.equal(
    readFileSync(path.join(root, 'build-calls.log'), 'utf8'),
    'build\nbuild\n',
  );
});
