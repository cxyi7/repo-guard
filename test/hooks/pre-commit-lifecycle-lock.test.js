import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { executionError } from '../../src/core/error/repo-guard-error.js';
import { resolveGitPath } from '../../src/git/repository.js';
import {
  acquirePreCommitLock,
  PRE_COMMIT_LOCK_FILE,
} from '../../src/orchestration/pre-commit/lifecycle-lock.js';

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
  assert.equal(JSON.parse(readFileSync(first.path, 'utf8')).version, 2);
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
    version: 2,
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

test('初始化中或陈旧的损坏 JSON 锁均保留，后续完整写入后可重试', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const lockPath = `${lockBasePath}.initializing`;
  const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
  for (const content of ['', '{', '{"version":2,"pid":']) {
    for (const timestamp of [oldTimestamp, new Date()]) {
      writeFileSync(lockPath, content);
      utimesSync(lockPath, timestamp, timestamp);
      assert.throws(() => acquirePreCommitLock(root), { code: 'pre-commit/invalid-lock-metadata' });
      assert.equal(readFileSync(lockPath, 'utf8'), content);
      assert.deepEqual(
        readdirSync(path.dirname(lockBasePath)).filter((name) => name.startsWith(`${PRE_COMMIT_LOCK_FILE}.`)),
        [path.basename(lockPath)],
      );
    }
  }
  writeFileSync(lockPath, JSON.stringify({ version: 2, pid: 2_147_483_647, token: 'finished-owner' }));
  const lock = acquirePreCommitLock(root);
  assert.equal(existsSync(lockPath), false);
  lock.release();
});

test('当前版本锁的 PID 或令牌无效时保留原文件，不按时间或进程状态清理', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const lockPath = `${lockBasePath}.invalid-owner`;
  const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
  const invalidMetadata = [
    ...[undefined, null, 0, -1, 1.5, '123', Number.MAX_SAFE_INTEGER + 1]
      .map((pid) => ({ version: 2, pid, token: 'owner' })),
    ...[undefined, null, '', '  ', 123]
      .flatMap((token) => [process.pid, 2_147_483_647].map((pid) => ({ version: 2, pid, token }))),
  ];
  for (const metadata of invalidMetadata) {
    const content = JSON.stringify(metadata);
    writeFileSync(lockPath, content);
    utimesSync(lockPath, oldTimestamp, oldTimestamp);
    assert.throws(() => acquirePreCommitLock(root), { code: 'pre-commit/invalid-lock-metadata' });
    assert.equal(readFileSync(lockPath, 'utf8'), content);
    assert.deepEqual(
      readdirSync(path.dirname(lockBasePath)).filter((name) => name.startsWith(`${PRE_COMMIT_LOCK_FILE}.`)),
      [path.basename(lockPath)],
    );
  }
});

test('无法确认持有进程已退出时保留有效锁并阻断', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const lockPath = `${lockBasePath}.unconfirmed-owner`;
  const content = JSON.stringify({ version: 2, pid: 123, token: 'unconfirmed-owner' });
  writeFileSync(lockPath, content);
  context.mock.method(process, 'kill', () => {
    throw executionError('test/lock-owner-inspection', '测试进程检查异常');
  });
  assert.throws(() => acquirePreCommitLock(root), { code: 'pre-commit/lock-owner-inspection-failed' });
  assert.equal(readFileSync(lockPath, 'utf8'), content);
});

test('旧版、未知版本和缺少版本的锁均拒绝执行，不因时间久远而删除', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const lockPath = `${lockBasePath}.unsupported-owner`;
  const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
  for (const version of [1, 99, undefined]) {
    for (const pid of [process.pid, 2_147_483_647]) {
      const content = `${JSON.stringify({ version, pid, token: 'unsupported-owner' })}\n`;
      writeFileSync(lockPath, content);
      utimesSync(lockPath, oldTimestamp, oldTimestamp);
      assert.throws(() => acquirePreCommitLock(root), {
        code: 'pre-commit/unsupported-lock-version',
      });
      assert.equal(readFileSync(lockPath, 'utf8'), content);
      assert.deepEqual(
        readdirSync(path.dirname(lockBasePath)).filter((name) => name.startsWith(`${PRE_COMMIT_LOCK_FILE}.`)),
        [path.basename(lockPath)],
      );
    }
  }
});
