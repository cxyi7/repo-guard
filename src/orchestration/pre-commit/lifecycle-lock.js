import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  executionError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { resolveGitPath } from '../../git/repository.js';

export const PRE_COMMIT_LOCK_FILE = 'repo-guard-pre-commit.lock';

const LOCK_VERSION = 1;
const LOCK_INITIALIZATION_GRACE_MS = 5_000;

function isMissingFileError(error) {
  return error?.code === 'ENOENT';
}

function processIsActive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readLockMetadata(lockPath) {
  let source;
  try {
    source = readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw executionError(
      'pre-commit/lock-read-failed',
      `无法读取 pre-commit 生命周期锁：${lockPath}`,
      { cause: error },
    );
  }

  try {
    const metadata = JSON.parse(source);
    if (
      metadata?.version === LOCK_VERSION
      && Number.isSafeInteger(metadata.pid)
      && typeof metadata.token === 'string'
      && metadata.token.length > 0
    ) {
      return metadata;
    }
  } catch {
    // 进程可能在锁文件创建后、元数据写完前退出；该文件按失效锁处理。
  }
  return null;
}

function lockIsInitializing(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs < LOCK_INITIALIZATION_GRACE_MS;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw executionError(
      'pre-commit/lock-inspection-failed',
      `无法检查 pre-commit 生命周期锁状态：${lockPath}`,
      { cause: error },
    );
  }
}

function listLockPaths(lockBasePath) {
  const lockDirectory = path.dirname(lockBasePath);
  const lockPrefix = `${path.basename(lockBasePath)}.`;
  try {
    return readdirSync(lockDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(lockPrefix))
      .map((entry) => path.join(lockDirectory, entry.name));
  } catch (error) {
    throw executionError(
      'pre-commit/lock-list-failed',
      `无法检查当前仓库的 pre-commit 生命周期锁：${lockDirectory}`,
      { cause: error },
    );
  }
}

function activeLockError(lockPath, metadata) {
  return executionError(
    'pre-commit/already-running',
    `已有 pre-commit 正在操作当前仓库，本次执行已在修改 Git 索引或工作区前停止（PID ${metadata.pid}）。`,
    {
      details: {
        evidence: [
          { type: 'pre-commit-lock', message: `生命周期锁：${lockPath}` },
          { type: 'pre-commit-owner', message: `持有进程 PID：${metadata.pid}` },
        ],
      },
      expected: '同一仓库只能有一个 pre-commit 实例操作暂存区、工作区和 lint-staged 备份。',
      remediation: {
        goal: '等待当前 pre-commit 完成后再重新提交。',
        steps: [
          `等待 PID ${metadata.pid} 对应的提交或 Hook 结束。`,
          '确认没有 IDE、终端或自动化任务同时提交后重新运行 git commit。',
        ],
        constraints: ['不要删除仍由活动进程持有的生命周期锁。'],
        verification: ['重新提交时不再出现 pre-commit/already-running。'],
      },
    },
  );
}

function removeStaleLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw executionError(
        'pre-commit/stale-lock-cleanup-failed',
        `无法清理失效的 pre-commit 生命周期锁：${lockPath}`,
        { cause: error },
      );
    }
  }
}

function releaseOwnedLock(lockPath, token) {
  const metadata = readLockMetadata(lockPath);
  if (metadata === undefined) return;
  if (metadata?.token !== token) {
    throw executionError(
      'pre-commit/lock-ownership-lost',
      `pre-commit 生命周期锁所有权已变化，拒绝删除其他进程的锁：${lockPath}`,
    );
  }
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw executionError(
        'pre-commit/lock-release-failed',
        `无法释放 pre-commit 生命周期锁：${lockPath}`,
        { cause: error },
      );
    }
  }
}

function inspectOtherLocks(lockBasePath, ownedPath) {
  for (const lockPath of listLockPaths(lockBasePath)) {
    if (lockPath === ownedPath) continue;
    const metadata = readLockMetadata(lockPath);
    if (metadata && processIsActive(metadata.pid)) {
      throw activeLockError(lockPath, metadata);
    }
    if (metadata === null && lockIsInitializing(lockPath)) {
      throw executionError(
        'pre-commit/lock-initializing',
        `另一个 pre-commit 正在初始化生命周期锁，本次执行已在修改 Git 前停止：${lockPath}`,
      );
    }
    if (metadata !== undefined) removeStaleLock(lockPath);
  }
}

export function acquirePreCommitLock(root) {
  const lockBasePath = resolveGitPath(root, PRE_COMMIT_LOCK_FILE);
  const token = randomUUID();
  const lockPath = `${lockBasePath}.${process.pid}.${token}`;
  const metadata = Object.freeze({
    version: LOCK_VERSION,
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
  });

  try {
    writeFileSync(lockPath, `${JSON.stringify(metadata)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    throw executionError(
      'pre-commit/lock-create-failed',
      `无法创建 pre-commit 生命周期锁：${lockPath}`,
      { cause: error },
    );
  }

  try {
    inspectOtherLocks(lockBasePath, lockPath);
  } catch (error) {
    releaseOwnedLock(lockPath, token);
    throw toRepoGuardError(error, {
      code: 'pre-commit/lock-acquire-failed',
      message: '无法取得 pre-commit 生命周期锁。',
    });
  }

  let released = false;
  return Object.freeze({
    path: lockPath,
    release() {
      if (released) return;
      releaseOwnedLock(lockPath, token);
      released = true;
    },
  });
}

export async function withPreCommitLock(root, action) {
  const lock = acquirePreCommitLock(root);
  try {
    return await action();
  } finally {
    lock.release();
  }
}
