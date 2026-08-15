import path from 'node:path';
import { configurationError } from '../core/error/repo-guard-error.js';
import { runGit } from './execution.js';

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
