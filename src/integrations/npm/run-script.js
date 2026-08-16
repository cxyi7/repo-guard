import { existsSync } from 'node:fs';
import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../core/execution/streaming-process.js';

function npmInvocation(script, extraArguments) {
  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!npmCli) throw executionError('npm/cli-not-found', '找不到 npm CLI');
  return {
    command: process.execPath,
    argumentsList: [npmCli, 'run', script, ...(extraArguments.length ? ['--', ...extraArguments] : [])],
  };
}

export async function runProjectScript({
  root,
  script,
  timeoutMs,
  extraArguments = [],
  signal = null,
  output = null,
}) {
  const invocation = npmInvocation(script, extraArguments);
  const execution = await runStreamingProcess({
    command: invocation.command,
    argumentsList: invocation.argumentsList,
    root,
    timeoutMs,
    signal,
    output,
  });
  return Object.freeze({
    command: invocation.command,
    argumentsList: Object.freeze(invocation.argumentsList),
    status: execution.status,
    signal: execution.signal,
    error: execution.error ?? null,
    stdout: execution.stdout ?? '',
    stderr: execution.stderr ?? '',
    timedOut: execution.timedOut,
  });
}
