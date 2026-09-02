import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveGitPath } from '../src/git/repository.js';
import {
  acquirePreCommitLock,
  PRE_COMMIT_LOCK_FILE,
} from '../src/orchestration/pre-commit/lifecycle-lock.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function createRepository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'pre-commit-lock-'));
  const result = spawnSync('git', ['init'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return root;
}

test('allows only one active pre-commit lifecycle owner per repository', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const first = acquirePreCommitLock(root);
  assert.equal(existsSync(first.path), true);
  assert.throws(
    () => acquirePreCommitLock(root),
    (error) => error?.code === 'pre-commit/already-running',
  );

  first.release();
  assert.equal(existsSync(first.path), false);

  const next = acquirePreCommitLock(root);
  next.release();
});

test('removes only the unique lifecycle lock left by an exited process', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const staleLockPath = `${lockBasePath}.2147483647.stale-owner`;
  writeFileSync(staleLockPath, `${JSON.stringify({
    version: 1,
    pid: 2_147_483_647,
    token: 'stale-owner',
    startedAt: '2026-01-01T00:00:00.000Z',
  })}\n`);

  const lock = acquirePreCommitLock(root);
  assert.equal(lock.path.startsWith(`${lockBasePath}.`), true);
  assert.equal(existsSync(staleLockPath), false);
  lock.release();
  assert.equal(existsSync(lock.path), false);
});

test('does not reclaim incomplete lock metadata during its initialization window', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const lockPath = `${lockBasePath}.initializing`;
  writeFileSync(lockPath, '{');

  assert.throws(
    () => acquirePreCommitLock(root),
    (error) => error?.code === 'pre-commit/lock-initializing',
  );
  assert.equal(existsSync(lockPath), true);

  const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
  utimesSync(lockPath, oldTimestamp, oldTimestamp);
  const lock = acquirePreCommitLock(root);
  lock.release();
});
