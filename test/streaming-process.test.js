import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cancellationError } from '../src/core/error/repo-guard-error.js';
import { runStreamingProcess } from '../src/core/execution/streaming-process.js';

function outputSink(onWrite) {
  return Object.freeze({
    write(value) {
      onWrite(String(value));
      return true;
    },
  });
}

test('streams sanitized output before completion while retaining process output', async (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-stream-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  let resolveFirstOutput;
  const firstOutput = new Promise((resolve) => {
    resolveFirstOutput = resolve;
  });
  const stdout = [];
  const stderr = [];
  const executionPromise = runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', [
      "console.log(`root=${process.cwd()} token=visible-secret`);",
      "console.error('warning-line');",
      "setTimeout(() => console.log('build-finished'), 150);",
    ].join('')],
    root,
    timeoutMs: 5000,
    output: {
      stdout: outputSink((value) => {
        stdout.push(value);
        resolveFirstOutput();
      }),
      stderr: outputSink((value) => stderr.push(value)),
    },
  });

  const firstEvent = await Promise.race([
    firstOutput.then(() => 'output'),
    executionPromise.then(() => 'completed'),
  ]);
  assert.equal(firstEvent, 'output');

  const execution = await executionPromise;
  assert.equal(execution.status, 0);
  assert.match(execution.stdout, /visible-secret/);
  assert.match(stdout.join(''), /root=<repo> token=\[REDACTED\]/);
  assert.doesNotMatch(stdout.join(''), /visible-secret/);
  assert.match(stdout.join(''), /build-finished/);
  assert.match(stderr.join(''), /warning-line/);
});

test('redacts multiline private keys from live output', async () => {
  const stdout = [];
  const execution = await runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', [
      "console.log('-----BEGIN PRIVATE KEY-----');",
      "console.log('private-material');",
      "console.log('-----END PRIVATE KEY-----');",
      "console.log('safe-output');",
    ].join('')],
    root: process.cwd(),
    timeoutMs: 5000,
    output: { stdout: outputSink((value) => stdout.push(value)) },
  });

  assert.equal(execution.status, 0);
  assert.match(stdout.join(''), /\[REDACTED PRIVATE KEY\]/);
  assert.doesNotMatch(stdout.join(''), /private-material/);
  assert.match(stdout.join(''), /safe-output/);
});

test('returns a timeout result after terminating a long-running process', async () => {
  const execution = await runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', "setInterval(() => {}, 1000);"],
    root: process.cwd(),
    timeoutMs: 100,
  });

  assert.equal(execution.timedOut, true);
  assert.equal(execution.error?.code, 'project-process/timeout');
});

test('terminates and rejects with the caller cancellation reason', async () => {
  const controller = new AbortController();
  const reason = cancellationError('test/process-cancelled', '测试取消');
  const executionPromise = runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', "setInterval(() => {}, 1000);"],
    root: process.cwd(),
    timeoutMs: 5000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(reason), 100);

  await assert.rejects(executionPromise, (error) => error === reason);
});
