import { spawn } from 'node:child_process';
import {
  cancellationError,
  executionError,
} from '../error/repo-guard-error.js';
import { sanitizeProcessOutput } from './output-safety.js';

const DEFAULT_CAPTURE_LIMIT = 1024 * 1024;
const PRIVATE_KEY_START_PATTERN = /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i;
const PRIVATE_KEY_END_PATTERN = /-----END [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i;

export function terminalProcessOutput(enabled) {
  return enabled
    ? Object.freeze({ stdout: process.stdout, stderr: process.stderr })
    : null;
}

function timeoutError(timeoutMs) {
  return executionError('project-process/timeout', `子进程执行超过 ${timeoutMs}ms`);
}

function appendCaptured(current, chunk, limit) {
  if (Buffer.byteLength(current, 'utf8') >= limit) return current;
  const remaining = limit - Buffer.byteLength(current, 'utf8');
  const value = Buffer.from(chunk).subarray(0, remaining).toString('utf8');
  return current + value;
}

function createLiveWriter(target, root) {
  let pending = '';
  let redactingPrivateKey = false;

  function writeSegment(segment) {
    if (PRIVATE_KEY_START_PATTERN.test(segment)) {
      redactingPrivateKey = !PRIVATE_KEY_END_PATTERN.test(segment);
      target.write('[REDACTED PRIVATE KEY]');
      const separator = segment.match(/[\r\n]+$/)?.[0];
      if (separator) target.write(separator);
      return;
    }
    if (redactingPrivateKey) {
      if (PRIVATE_KEY_END_PATTERN.test(segment)) redactingPrivateKey = false;
      const separator = segment.match(/[\r\n]+$/)?.[0];
      if (separator) target.write(separator);
      return;
    }
    target.write(sanitizeProcessOutput(segment, {
      root,
      limit: Number.MAX_SAFE_INTEGER,
    }).text);
  }

  function flushCompleteSegments() {
    let boundary = pending.search(/[\r\n]/);
    while (boundary !== -1) {
      let end = boundary + 1;
      while (end < pending.length && /[\r\n]/.test(pending[end])) end += 1;
      writeSegment(pending.slice(0, end));
      pending = pending.slice(end);
      boundary = pending.search(/[\r\n]/);
    }
  }

  return Object.freeze({
    push(chunk) {
      pending += chunk.toString('utf8');
      flushCompleteSegments();
    },
    flush() {
      if (pending) writeSegment(pending);
      pending = '';
    },
  });
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => resolve());
      killer.on('close', () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export async function runStreamingProcess({
  command,
  argumentsList,
  root,
  env = process.env,
  timeoutMs,
  signal = null,
  output = null,
  captureLimit = DEFAULT_CAPTURE_LIMIT,
}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: root,
      detached: process.platform !== 'win32',
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutWriter = output?.stdout ? createLiveWriter(output.stdout, root) : null;
    const stderrWriter = output?.stderr ? createLiveWriter(output.stderr, root) : null;
    let stdout = '';
    let stderr = '';
    let processError = null;
    let cancellationReason = null;
    let timedOut = false;
    let settled = false;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      stdoutWriter?.flush();
      stderrWriter?.flush();
      handler(value);
    };
    const stop = (reason, { cancelled = false } = {}) => {
      if (settled || cancellationReason || processError) return;
      if (cancelled) cancellationReason = reason;
      else processError = reason;
      void terminateProcessTree(child);
    };
    const abort = () => stop(
      signal.reason instanceof Error
        ? signal.reason
        : cancellationError('project-process/cancelled', '子进程执行已取消'),
      { cancelled: true },
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      stop(timeoutError(timeoutMs));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendCaptured(stdout, chunk, captureLimit);
      stdoutWriter?.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCaptured(stderr, chunk, captureLimit);
      stderrWriter?.push(chunk);
    });
    child.on('error', (error) => {
      processError = error;
    });
    child.on('close', (status, closeSignal) => {
      if (cancellationReason) {
        finish(reject, cancellationReason);
        return;
      }
      finish(resolve, Object.freeze({
        status,
        signal: closeSignal,
        error: processError,
        stdout,
        stderr,
        timedOut,
      }));
    });
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
