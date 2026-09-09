import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
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

const LOCK_VERSION = 2;

function isMissingFileError(error) {
  return error?.code === 'ENOENT';
}

function processIsActive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw executionError(
      'pre-commit/lock-owner-inspection-failed',
      `无法确认 pre-commit 锁持有进程是否已退出，已保留锁并停止执行（PID ${pid}）。`,
      { cause: error, expected: '仅在确认持有进程已退出后回收当前格式的锁。' },
    );
  }
}

function invalidLockMetadataError(lockPath) {
  return executionError(
    'pre-commit/invalid-lock-metadata',
    `pre-commit 生命周期锁元数据尚未写完或已损坏，已停止执行并保留该锁：${lockPath}`,
    {
      details: { location: { path: lockPath } },
      expected: '锁必须包含当前版本、正整数 PID 和非空所有权令牌；不按文件时间回收无法识别的锁。',
      remediation: {
        goal: '确认锁的写入与持有进程状态后重新提交。',
        steps: ['等待正在初始化的提交进程完成后重试。', '若仍无法识别，等待相关进程退出，再由人工核对并处理遗留锁。'],
        constraints: ['不得删除仍由活动进程持有的锁，也不得伪造元数据绕过互斥。'],
        verification: ['重新提交，不再出现 pre-commit/invalid-lock-metadata。'],
      },
    },
  );
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

  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch {
    throw invalidLockMetadataError(lockPath);
  }
  if (metadata?.version !== LOCK_VERSION) {
    throw executionError(
      'pre-commit/unsupported-lock-version',
      `pre-commit 生命周期锁不是当前版本 ${LOCK_VERSION}，已停止执行并保留该锁：${lockPath}`,
      {
        expected: '只读取当前锁格式；不将旧版或未知版本的锁视为失效锁。',
        remediation: {
          goal: '确认锁的归属与进程状态后重新提交。',
          steps: ['等待相关提交进程退出，再由人工核对并处理遗留锁。'],
          constraints: ['不得删除仍由活动进程持有的锁，也不得改写锁版本绕过互斥。'],
          verification: ['重新提交，不再出现 pre-commit/unsupported-lock-version。'],
        },
      },
    );
  }
  if (
    !Number.isSafeInteger(metadata.pid)
    || metadata.pid <= 0
    || typeof metadata.token !== 'string'
    || metadata.token.trim().length === 0
  ) {
    throw invalidLockMetadataError(lockPath);
  }
  return metadata;
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
