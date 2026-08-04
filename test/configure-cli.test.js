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

  const enableResult = run(root, ['enable', 'eslint', 'prettier']);
  assert.equal(enableResult.status, 0, enableResult.stderr);
  assert.match(enableResult.stdout, /eslint: enabled/);
  assert.match(enableResult.stdout, /prettier: enabled/);

  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );
  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.prettier.enabled, true);
});
