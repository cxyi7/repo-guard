import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';

function npmInvocation(script, extraArguments) {
  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!npmCli) throw executionError('npm/cli-not-found', 'Unable to locate npm CLI');
  return {
    command: process.execPath,
    argumentsList: [npmCli, 'run', script, ...(extraArguments.length ? ['--', ...extraArguments] : [])],
  };
}

export function runProjectScript({
  root,
  script,
  timeoutMs,
  extraArguments = [],
}) {
  const invocation = npmInvocation(script, extraArguments);
  const execution = spawnSync(invocation.command, invocation.argumentsList, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    shell: false,
  });
  return Object.freeze({
    command: invocation.command,
    argumentsList: Object.freeze(invocation.argumentsList),
    status: execution.status,
    signal: execution.signal,
    error: execution.error ?? null,
    stdout: execution.stdout ?? '',
    stderr: execution.stderr ?? '',
    timedOut: execution.error?.code === 'ETIMEDOUT',
  });
}
