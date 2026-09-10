import { spawnSync } from 'node:child_process';
import { createGitCommandError } from './command-error.js';

export function runGit(args, { allowFailure = false, cwd } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error || result.signal || !Number.isInteger(result.status) || result.status < 0) {
    throw createGitCommandError(result, { cwd });
  }

  if (!allowFailure && result.status !== 0) {
    throw createGitCommandError(result, { cwd });
  }

  return {
    status: result.status,
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

  if (result.error || result.signal || !Number.isInteger(result.status) || result.status < 0) {
    throw createGitCommandError(result, { cwd, binary: true });
  }
  if (!allowFailure && result.status !== 0) {
    throw createGitCommandError(result, { cwd, binary: true });
  }
  return {
    status: result.status,
    stdout: Buffer.from(result.stdout || []),
    stderr: Buffer.from(result.stderr || []),
  };
}

export function gitValue(args, fallback = '', cwd) {
  const result = runGit(args, { allowFailure: true, cwd });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
}
