import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  cancellationError,
  executionError,
} from '../../core/error/repo-guard-error.js';
import {
  containsSensitiveOutput,
  redactOutput,
} from '../../core/execution/output-safety.js';
import {
  processTerminationFailure,
  releaseProcessHandles,
  terminateProcessTree,
} from '../../core/execution/process-tree.js';

const OUTPUT_LIMIT = 1024 * 1024;

function startError(cause) {
  return executionError('external-gate/process-start-failed', '无法启动外部门禁子进程。', {
    cause,
    details: {
      processCode: cause.code ?? null,
      evidence: [{ type: 'process-start', message: `子进程启动失败，系统错误代码：${cause.code ?? '未知'}。` }],
    },
  });
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function redactExternalOutput(value) {
  return redactOutput(value);
}

export function containsSensitiveExternalData(value) {
  return containsSensitiveOutput(value);
}

async function runExactNpmInvocation({ root, argumentsList, signal, env = process.env }, {
  spawnProcess = spawn,
  terminateProcess = terminateProcessTree,
} = {}) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : cancellationError('external-gate/cancelled', '外部门禁执行已取消');
  }
  const npmCli = npmCliPath();
  if (!npmCli) throw executionError('npm/cli-not-found', '找不到当前 Node.js 安装所使用的 npm CLI');
  return await new Promise((resolve, reject) => {
    let settled = false;
    let terminating = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      releaseProcessHandles(child);
      handler(value);
    };
    let child;
    try {
      child = spawnProcess(process.execPath, [npmCli, ...argumentsList], {
        cwd: root,
        detached: process.platform !== 'win32',
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(startError(error));
      return;
    }
    let stdout = '';
    let stderr = '';
    let size = 0;
    const terminate = async (reason) => {
      if (settled || terminating) return;
      terminating = true;
      try {
        await terminateProcess(child);
        finish(reject, reason);
      } catch (error) {
        finish(reject, processTerminationFailure(reason, error, 'external-gate/termination-failed'));
      }
    };
    const collect = (stream) => (chunk) => {
      if (settled || terminating) return;
      size += chunk.length;
      if (size > OUTPUT_LIMIT) {
        void terminate(executionError(
          'external-gate/output-limit-exceeded',
          `外部门禁输出超过 ${OUTPUT_LIMIT} 字节`,
        ));
        return;
      }
      if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (error) => {
      if (!terminating) finish(reject, startError(error));
    });
    child.on('close', (status, closeSignal) => {
      if (terminating) return;
      finish(resolve, {
        status: status ?? 1,
        signal: closeSignal,
        stdout: redactExternalOutput(stdout),
        stderr: redactExternalOutput(stderr),
      });
    });
    const abort = () => {
      const error = signal.reason instanceof Error
        ? signal.reason
        : cancellationError('external-gate/cancelled', '外部门禁执行已取消');
      void terminate(error);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function runExactNpmScript({ root, script, signal, env }, runtime) {
  return await runExactNpmInvocation({ root, argumentsList: ['run', script], signal, env }, runtime);
}

export async function runExactNpmCommand({ root, argumentsList, signal, env }, runtime) {
  if (!Array.isArray(argumentsList) || argumentsList.length === 0
    || argumentsList.some((argument) => typeof argument !== 'string' || argument === '')) {
    throw new TypeError('npm argumentsList 必须包含非空字符串');
  }
  return await runExactNpmInvocation({ root, argumentsList, signal, env }, runtime);
}
