import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runDoctor } from '../src/commands/doctor.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function createRepository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'doctor-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('doctor --fix reconciles safe managed repository state', async (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const exitCode = await runDoctor(root, { fix: true });
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );

  assert.equal(exitCode, 0);
  assert.equal(packageJson.scripts['guard:migrate'], 'repo-guard migrate');
  assert.equal(
    packageJson.scripts['guard:enable-quality'],
    'repo-guard enable eslint prettier',
  );
  assert.equal(packageJson.scripts.prepare, 'repo-guard install-hooks');
  assert.equal(config.preCommit.eslint.enabled, false);
  assert.equal(config.preCommit.prettier.enabled, false);
  assert.match(
    readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8'),
    /repo-guard-managed:v2/,
  );
});
