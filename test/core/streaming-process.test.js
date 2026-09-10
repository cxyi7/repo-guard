import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { cancellationError, executionError } from '../../src/core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../src/core/execution/streaming-process.js';
import { terminateProcessTree } from '../../src/core/execution/process-tree.js';

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

test('超时后的进程树清理失败仍返回可追溯的终止错误', async () => {
  const execution = await runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', 'setTimeout(() => {}, 1200);'],
    root: process.cwd(),
    timeoutMs: 20,
  }, {
    async terminateProcess(child) {
      child.kill('SIGKILL');
      throw executionError('process-tree/termination-failed', '测试进程树清理失败');
    },
  });
  assert.equal(execution.timedOut, true);
  assert.equal(execution.error.code, 'project-process/termination-failed');
  assert.equal(execution.error.details.reasonCode, 'project-process/timeout');
  assert.equal(execution.error.cause.code, 'process-tree/termination-failed');
});

test('启动失败返回带中文说明的稳定错误类型', async () => {
  const execution = await runStreamingProcess({
    command: path.join(process.cwd(), 'missing-streaming-process-command'),
    argumentsList: [], root: process.cwd(), timeoutMs: 5000,
  });
  assert.equal(execution.error.code, 'project-process/start-failed');
  assert.equal(execution.error.kind, 'execution');
  assert.match(execution.error.message, /无法启动/);
  assert.equal(execution.error.cause.code, 'ENOENT');
});

test('取消清理失败后不等待管道 close，且保留取消原因', async () => {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 1234, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(),
    unreferenced: false,
    unref() { this.unreferenced = true; },
  });
  const controller = new AbortController();
  const reason = cancellationError('test/cancelled', '测试取消');
  const execution = runStreamingProcess({
    command: process.execPath, argumentsList: [], root: process.cwd(),
    timeoutMs: 5000, signal: controller.signal,
  }, {
    spawnProcess: () => child,
    terminateProcess: async () => { throw executionError('process-tree/termination-failed', '测试清理失败'); },
  });
  controller.abort(reason);
  await assert.rejects(execution, (error) => {
    assert.equal(error.code, 'project-process/termination-failed');
    assert.equal(error.details.reasonCode, 'test/cancelled');
    return true;
  });
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.unreferenced, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('已取消的流式执行不会启动子进程', async () => {
  const controller = new AbortController();
  const reason = cancellationError('test/already-cancelled', '测试调用已取消');
  controller.abort(reason);
  await assert.rejects(runStreamingProcess({
    command: process.execPath, argumentsList: [], root: process.cwd(),
    timeoutMs: 5000, signal: controller.signal,
  }, { spawnProcess() { assert.fail('已取消的调用不得创建进程'); } }), (error) => error === reason);
});

test('流式输出仍保留捕获上限和实时脱敏', async () => {
  const output = [];
  const execution = await runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', "console.log('x'.repeat(200)); console.log('token=secret-value');"],
    root: process.cwd(), timeoutMs: 5000, captureLimit: 100,
    output: { stdout: outputSink((value) => output.push(value)) },
  });
  assert.equal(execution.status, 0);
  assert.equal(Buffer.byteLength(execution.stdout), 100);
  assert.match(output.join(''), /token=\[REDACTED\]/);
  assert.doesNotMatch(output.join(''), /secret-value/);
});

test('实际终止命令不存在时直杀有限子进程，无需等待原始运行时长', async (context) => {
  let child;
  let observeExit;
  const exited = new Promise((resolve) => { observeExit = resolve; });
  context.after(() => child?.kill('SIGKILL'));
  const started = Date.now();
  const execution = await runStreamingProcess({
    command: process.execPath,
    argumentsList: ['-e', 'setTimeout(() => {}, 10000);'],
    root: process.cwd(), timeoutMs: 50,
  }, {
    spawnProcess(command, argumentsList, options) {
      child = spawn(command, argumentsList, options);
      child.once('exit', observeExit);
      return child;
    },
    terminateProcess(target) {
      return terminateProcessTree(target, {
        platform: 'win32',
        spawnProcess: () => spawn(path.join(process.cwd(), 'missing-taskkill-command'), [], {
          stdio: 'ignore', windowsHide: true,
        }),
      });
    },
  });
  let exitTimer;
  const observed = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => { exitTimer = setTimeout(() => resolve(false), 3000); }),
  ]);
  clearTimeout(exitTimer);
  assert.equal(observed, true, '直杀回收必须产生父进程退出事件');
  assert.ok(Date.now() - started < 5000, '有限子进程必须在原始 10 秒运行时长之前被回收');
  assert.equal(execution.error.code, 'project-process/termination-failed');
  assert.equal(execution.error.details.causeCode, 'ENOENT');
  assert.equal(child.killed, true);
});

function liveOutputFixture(context) {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 1234, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(), unref() {},
  });
  const output = [];
  const execution = runStreamingProcess({
    command: process.execPath, argumentsList: [], root: process.cwd(), timeoutMs: 5000,
    output: { stdout: outputSink((value) => output.push(value)) },
  }, { spawnProcess: () => child, terminateProcess: async () => {} });
  context.after(() => child.emit('close', 0, null));
  return { child, output, execution };
}

test('持续无换行输出超过缓冲上限后整行丢弃且仅提示一次', async (context) => {
  const { child, output, execution } = liveOutputFixture(context);
  child.stdout.write('x'.repeat(1024 * 1024));
  assert.equal(output.length, 0);
  child.stdout.write('overflow-secret');
  const firstNotice = output.join('');
  assert.match(firstNotice, /输出行超过 1048576 字节，已丢弃该行/);
  for (let index = 0; index < 40; index += 1) child.stdout.write('y'.repeat(64 * 1024));
  assert.equal(output.join(''), firstNotice);
  child.emit('close', 0, null);
  const result = await execution;
  assert.equal(output.join(''), firstNotice);
  assert.equal(Buffer.byteLength(result.stdout), 1024 * 1024);
  assert.doesNotMatch(firstNotice, /overflow-secret|x{100}|y{100}/);
});

test('长行截断不输出部分内容，遇到换行后恢复实时脱敏', async (context) => {
  const { child, output, execution } = liveOutputFixture(context);
  child.stdout.write(`token=discarded-secret ${'x'.repeat(1024 * 1024)}\r\nsafe token=visible-secret\n`);
  assert.ok(/输出行超过/.test(output.join('')));
  assert.match(output.join(''), /safe token=\[REDACTED\]/);
  assert.doesNotMatch(output.join(''), /discarded-secret|visible-secret|x{100}/);
  child.emit('close', 0, null);
  await execution;
});

for (const position of ['across-limit', 'after-discard']) {
  test(`跨 chunk 私钥头在 ${position} 的长行中仍保护后续私钥内容`, async (context) => {
    const { child, output, execution } = liveOutputFixture(context);
    child.stdout.write('x'.repeat(1024 * 1024 + (position === 'across-limit' ? -8 : 1)));
    child.stdout.write('-----BEG');
    child.stdout.write('IN RSA PR');
    child.stdout.write('IVATE KEY-----\nprivate-material\n-----END RSA PRI');
    child.stdout.write('VATE KEY-----\nsafe-output\n');
    child.emit('close', 0, null);
    await execution;
    assert.match(output.join(''), /输出行超过/);
    assert.match(output.join(''), /safe-output/);
    assert.doesNotMatch(output.join(''), /private-material|x{100}/);
  });
}

test('私钥正文超长时仍保留跨 chunk 结束标记并恢复后续输出', async (context) => {
  const { child, output, execution } = liveOutputFixture(context);
  child.stdout.write('-----BEGIN PRIVATE KEY-----\n');
  child.stdout.write('private-material'.repeat(100000));
  child.stdout.write('-----EN');
  child.stdout.write('D PRIVATE KEY-----\nsafe-output\n');
  child.emit('close', 0, null);
  await execution;
  assert.match(output.join(''), /\[REDACTED PRIVATE KEY\]/);
  assert.match(output.join(''), /输出行超过/);
  assert.match(output.join(''), /safe-output/);
  assert.doesNotMatch(output.join(''), /private-material/);
});
