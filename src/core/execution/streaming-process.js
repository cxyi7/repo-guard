import { spawn } from 'node:child_process';
import {
  cancellationError,
  executionError,
} from '../error/repo-guard-error.js';
import { sanitizeProcessOutput } from './output-safety.js';
import {
  processTerminationFailure,
  releaseProcessHandles,
  terminateProcessTree,
} from './process-tree.js';

const DEFAULT_CAPTURE_LIMIT = 1024 * 1024;
const MAX_LIVE_LINE_BYTES = 1024 * 1024;
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

function startError(cause) {
  return executionError('project-process/start-failed', '无法启动子进程。', {
    cause,
    details: {
      processCode: cause.code ?? null,
      evidence: [{ type: 'process-start', message: `子进程启动失败，系统错误代码：${cause.code ?? '未知'}。` }],
    },
  });
}

function appendCaptured(current, chunk, limit) {
  if (Buffer.byteLength(current, 'utf8') >= limit) return current;
  const remaining = limit - Buffer.byteLength(current, 'utf8');
  const value = Buffer.from(chunk).subarray(0, remaining).toString('utf8');
  return current + value;
}

/** 丢弃长行时只保存固定长度标记状态，私钥头尾跨 chunk 或超长仍可辨认。 */
function createDiscardedLineScanner(initialRedaction) {
  let redacting = initialRedaction;
  let prefix = '';
  let marker = null;
  let suffix = '';
  let hyphens = 0;
  return {
    redacting: () => redacting,
    push(text) {
      for (const character of text.toUpperCase()) {
        if (marker) {
          if (character === '-') {
            hyphens += 1;
            if (hyphens === 5) {
              if (suffix.endsWith('PRIVATE KEY')) redacting = marker === 'BEGIN';
              marker = null;
            }
          } else if (hyphens > 0) {
            marker = null;
          } else {
            suffix = (suffix + character).slice(-11);
          }
        }
        prefix = (prefix + character).slice(-11);
        if (prefix.endsWith('-----BEGIN ') || prefix.endsWith('-----END ')) {
          marker = prefix.endsWith('-----BEGIN ') ? 'BEGIN' : 'END';
          suffix = '';
          hyphens = 0;
        }
      }
    },
  };
}

function createLiveWriter(target, root) {
  let pending = '';
  let pendingBytes = 0;
  let discardedLine = null;
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

  function appendSegment(segment) {
    if (discardedLine) {
      discardedLine.push(segment);
      return;
    }
    const size = Buffer.byteLength(segment, 'utf8');
    if (pendingBytes + size > MAX_LIVE_LINE_BYTES) {
      discardedLine = createDiscardedLineScanner(redactingPrivateKey);
      discardedLine.push(pending);
      discardedLine.push(segment);
      pending = '';
      pendingBytes = 0;
      target.write(`[输出行超过 ${MAX_LIVE_LINE_BYTES} 字节，已丢弃该行]\n`);
      return;
    }
    pending += segment;
    pendingBytes += size;
  }

  function finishLine(separator) {
    if (discardedLine) {
      redactingPrivateKey = discardedLine.redacting();
      target.write(separator);
    } else writeSegment(pending + separator);
    pending = '';
    pendingBytes = 0;
    discardedLine = null;
  }

  return Object.freeze({
    push(chunk) {
      const text = chunk.toString('utf8');
      let offset = 0;
      for (const match of text.matchAll(/[\r\n]+/g)) {
        appendSegment(text.slice(offset, match.index));
        finishLine(match[0]);
        offset = match.index + match[0].length;
      }
      appendSegment(text.slice(offset));
    },
    flush() {
      if (pending) writeSegment(pending);
      pending = '';
      pendingBytes = 0;
      discardedLine = null;
    },
  });
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
}, { spawnProcess = spawn, terminateProcess = terminateProcessTree } = {}) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : cancellationError('project-process/cancelled', '子进程执行已取消');
  }
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command, argumentsList, {
        cwd: root,
        detached: process.platform !== 'win32',
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve(Object.freeze({
        status: null, signal: null, stdout: '', stderr: '', timedOut: false,
        error: startError(error),
      }));
      return;
    }
    const stdoutWriter = output?.stdout ? createLiveWriter(output.stdout, root) : null;
    const stderrWriter = output?.stderr ? createLiveWriter(output.stderr, root) : null;
    let stdout = '';
    let stderr = '';
    let processError = null;
    let cancellationReason = null;
    let timedOut = false;
    let settled = false;
    let terminating = false;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      releaseProcessHandles(child);
      stdoutWriter?.flush();
      stderrWriter?.flush();
      handler(value);
    };
    const complete = (status = child.exitCode, closeSignal = child.signalCode) => {
      if (cancellationReason) {
        finish(reject, cancellationReason);
        return;
      }
      finish(resolve, Object.freeze({
        status, signal: closeSignal, error: processError, stdout, stderr, timedOut,
      }));
    };
    const stop = async (reason, { cancelled = false } = {}) => {
      if (settled || terminating) return;
      terminating = true;
      if (cancelled) cancellationReason = reason;
      else processError = reason;
      try {
        await terminateProcess(child);
      } catch (error) {
        const failure = processTerminationFailure(reason, error, 'project-process/termination-failed');
        if (cancelled) cancellationReason = failure;
        else processError = failure;
      }
      complete();
    };
    const abort = () => stop(
      signal.reason instanceof Error
        ? signal.reason
        : cancellationError('project-process/cancelled', '子进程执行已取消'),
      { cancelled: true },
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      void stop(timeoutError(timeoutMs));
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
      if (settled || terminating) return;
      processError = startError(error);
      complete();
    });
    child.on('close', (status, closeSignal) => {
      if (!terminating) complete(status, closeSignal);
    });
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
