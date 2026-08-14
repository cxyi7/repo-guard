import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { configurationError, executionError } from './core/error/repo-guard-error.js';

export function runGit(args, { allowFailure = false, cwd } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw executionError('git/process-start-failed', `Git command failed: ${result.error.message}`, {
      cause: result.error,
      expected: 'Git 可执行文件能够在当前仓库中启动。',
    });
  }

  if (!allowFailure && result.status !== 0) {
    const message = (result.stderr || result.stdout || 'Git command failed').trim();
    throw executionError('git/command-failed', message, {
      details: {
        evidence: [{ type: 'git-exit-status', message: `exit status: ${String(result.status)}` }],
      },
      expected: `git ${args[0] || '<command>'} completes successfully.`,
    });
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function gitValue(args, fallback = '', cwd) {
  const result = runGit(args, { allowFailure: true, cwd });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}

export function findRepositoryRoot(cwd = process.cwd(), { allowMissing = false } = {}) {
  const result = runGit(['rev-parse', '--show-toplevel'], {
    allowFailure: true,
    cwd,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    if (allowMissing) {
      return null;
    }
    throw configurationError('git/not-a-repository', '当前工作目录不在 Git 仓库中', {
      details: { evidence: [{ type: 'repository-discovery', message: 'git rev-parse --show-toplevel returned no repository root' }] },
      expected: '从目标 Git 仓库目录或其子目录运行 repo-guard。',
      remediation: {
        goal: '切换到正确的 Git 仓库后重新运行命令',
        steps: ['确认目录包含 .git，或使用 git init 初始化预期仓库'],
        constraints: ['不要在不确定的目录中初始化新仓库'],
        verification: ['运行 git rev-parse --show-toplevel'],
      },
    });
  }

  return path.resolve(result.stdout.trim());
}

export function resolveGitPath(root, name) {
  const configuredPath = runGit(['rev-parse', '--git-path', name], { cwd: root }).stdout.trim();
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(root, configuredPath);
}
