import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runPrePush } from '../src/orchestration/pre-push/runner.js';
import {
  runTypeCheckGate,
} from '../src/gates/quality/typecheck-gate.js';
import { detectProjectTypeCheckSetup } from '../src/gates/quality/typecheck-setup.js';
import { validateTypeCheckSetup } from '../src/integrations/npm/typecheck.js';

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

function typeCheckConfig(extra = {}) {
  return {
    enabled: true,
    script: 'typecheck',
    timeoutMs: 30000,
    ...extra,
  };
}

function createFixture({ enabled = true } = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'typecheck-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'typecheck-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { typecheck: 'node typecheck.mjs' },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'typecheck.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "appendFileSync('typecheck-calls.log', 'typecheck\\n');",
      "if (existsSync('fail-typecheck')) process.exitCode = 7;",
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      typeCheck: { ...typeCheckConfig(), enabled },
      notification: { enabled: false },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('detects and validates the consuming project typecheck script', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(validateTypeCheckSetup(root, typeCheckConfig()), {
    command: 'node typecheck.mjs',
  });
  assert.equal(detectProjectTypeCheckSetup(root, typeCheckConfig()).ready, true);
  assert.throws(
    () => validateTypeCheckSetup(root, typeCheckConfig({ script: 'missing' })),
    /requires package.json script "missing"/,
  );
});

test('runs the consuming project typecheck script and blocks failures', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const passed = runTypeCheckGate({ root, config: typeCheckConfig() });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.diagnostics.some(({ message }) => message.includes('typecheck-fixture')), true);
  writeFileSync(path.join(root, 'fail-typecheck'), 'fail\n');
  const failed = runTypeCheckGate({ root, config: typeCheckConfig() });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.diagnostics.some(({ message }) => message.includes('typecheck-fixture')), true);
  assert.equal(
    readFileSync(path.join(root, 'typecheck-calls.log'), 'utf8'),
    'typecheck\ntypecheck\n',
  );
});

test('exposes TypeScript through CLI and runs it first from pre-push', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const cliResult = spawnSync(process.execPath, [CLI_PATH, 'typecheck'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /TypeScript passed/);
  commitFixture(root);
  assert.equal(await runPrePush(root), 0);
  assert.equal(existsSync(path.join(root, 'typecheck-calls.log')), true);
  assert.equal(
    readFileSync(path.join(root, 'typecheck-calls.log'), 'utf8'),
    'typecheck\ntypecheck\n',
  );
});
