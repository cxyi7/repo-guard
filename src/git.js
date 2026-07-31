import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function runGit(args, { allowFailure = false, cwd } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Git command failed: ${result.error.message}`);
  }

  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Git command failed').trim());
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
    throw new Error(`Not inside a Git repository: ${path.resolve(cwd)}`);
  }

  return path.resolve(result.stdout.trim());
}

export function resolveGitPath(root, name) {
  const configuredPath = runGit(['rev-parse', '--git-path', name], { cwd: root }).stdout.trim();
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(root, configuredPath);
}
