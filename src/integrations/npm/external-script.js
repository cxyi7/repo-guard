import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  cancellationError,
  executionError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import {
  containsSensitiveOutput,
  redactOutput,
} from '../../core/execution/output-safety.js';

const OUTPUT_LIMIT = 1024 * 1024;

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', reject);
      killer.on('close', (status) => {
        if (status === 0 || child.exitCode != null || child.signalCode != null) resolve();
        else reject(executionError(
          'external-gate/process-tree-termination-failed',
          `无法终止外部门禁进程树（taskkill 退出码为 ${status}）`,
        ));
      });
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (child.exitCode == null && child.signalCode == null && !child.kill('SIGKILL')) {
      throw toRepoGuardError(error, {
        kind: 'execution',
        code: 'external-gate/process-tree-termination-failed',
      });
    }
  }
}

export function redactExternalOutput(value) {
  return redactOutput(value);
}

export function containsSensitiveExternalData(value) {
  return containsSensitiveOutput(value);
}

async function runExactNpmInvocation({ root, argumentsList, signal, env = process.env }) {
  const npmCli = npmCliPath();
  if (!npmCli) throw executionError('npm/cli-not-found', '找不到当前 Node.js 安装所使用的 npm CLI');
  return await new Promise((resolve, reject) => {
    let settled = false;
    let terminating = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };
    const child = spawn(process.execPath, [npmCli, ...argumentsList], {
      cwd: root,
      detached: process.platform !== 'win32',
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let size = 0;
    const terminate = async (reason) => {
      if (settled || terminating) return;
      terminating = true;
      try {
        await terminateProcessTree(child);
        finish(reject, reason);
      } catch (error) {
        finish(reject, executionError(
          'external-gate/termination-failed',
          `${reason.message}; ${error.message}`,
          {
            cause: error,
            details: { evidence: [{ type: 'termination-reason', message: reason.message }] },
          },
        ));
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
      if (!terminating) finish(reject, toRepoGuardError(error, {
        kind: 'execution',
        code: 'external-gate/process-start-failed',
      }));
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
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    child.on('close', () => signal.removeEventListener('abort', abort));
  });
}

export async function runExactNpmScript({ root, script, signal, env }) {
  return await runExactNpmInvocation({ root, argumentsList: ['run', script], signal, env });
}

export async function runExactNpmCommand({ root, argumentsList, signal, env }) {
  if (!Array.isArray(argumentsList) || argumentsList.length === 0
    || argumentsList.some((argument) => typeof argument !== 'string' || argument === '')) {
    throw new TypeError('npm argumentsList 必须包含非空字符串');
  }
  return await runExactNpmInvocation({ root, argumentsList, signal, env });
}
