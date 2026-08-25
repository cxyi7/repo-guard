import { spawnSync } from 'node:child_process';
import { executionError } from '../core/error/repo-guard-error.js';

export function runGit(args, { allowFailure = false, cwd } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw executionError('git/process-start-failed', `Git 命令执行失败： ${result.error.message}`, {
      cause: result.error,
      expected: 'Git 可执行文件能够在当前仓库中启动。',
    });
  }

  if (!allowFailure && result.status !== 0) {
    const message = (result.stderr || result.stdout || 'Git 命令执行失败').trim();
    throw executionError('git/command-failed', message, {
      details: {
        evidence: [{ type: 'git-exit-status', message: `退出状态： ${String(result.status)}` }],
      },
      expected: `git ${args[0] || '<command>'} 必须成功完成。`,
    });
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function runGitBinary(args, {
  allowFailure = false,
  cwd,
  input = null,
  maxBuffer = 210000000,
} = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: null,
    input,
    maxBuffer,
    windowsHide: true,
  });

  if (result.error) {
    throw executionError('git/binary-process-start-failed', `Git 二进制命令执行失败：${result.error.message}`, {
      cause: result.error,
      expected: 'Git 必须能够安全读取暂存区或提交对象中的二进制文件。',
    });
  }
  if (!allowFailure && result.status !== 0) {
    const diagnostic = Buffer.from(result.stderr || result.stdout || []).toString('utf8').trim();
    throw executionError('git/binary-command-failed', diagnostic || 'Git 二进制命令执行失败', {
      expected: `git ${args[0] || '<command>'} 必须成功完成。`,
    });
  }
  return {
    status: result.status ?? 1,
    stdout: Buffer.from(result.stdout || []),
    stderr: Buffer.from(result.stderr || []),
  };
}

export function gitValue(args, fallback = '', cwd) {
  const result = runGit(args, { allowFailure: true, cwd });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}
