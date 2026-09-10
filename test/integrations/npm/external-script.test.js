import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { cancellationError } from '../../../src/core/error/repo-guard-error.js';
import { terminateProcessTree } from '../../../src/core/execution/process-tree.js';
import { createGateResult } from '../../../src/core/result/gate-result.js';
import { runExactNpmCommand } from '../../../src/integrations/npm/external-script.js';

function childProcess() {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 1234, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(),
    unreferenced: false, kills: [],
    unref() { this.unreferenced = true; },
    kill(signal) { this.kills.push(signal); return true; },
  });
  return child;
}

function invocation(signal) {
  return { root: process.cwd(), argumentsList: ['--version'], signal };
}

function missingTaskkill(child) {
  return terminateProcessTree(child, {
    platform: 'win32', timeoutMs: 50,
    spawnProcess() {
      const killer = childProcess();
      queueMicrotask(() => killer.emit('error', Object.assign(
        new TypeError('spawn taskkill ENOENT token=cleanup-secret'), { code: 'ENOENT' },
      )));
      return killer;
    },
  });
}

test('外部执行清理失败后不等待 close，并移除取消监听与管道引用', async () => {
  const child = childProcess();
  const controller = new AbortController();
  const reason = cancellationError('test/cancelled', '测试取消外部执行');
  const execution = runExactNpmCommand(invocation(controller.signal), {
    spawnProcess: () => child, terminateProcess: missingTaskkill,
  });
  controller.abort(reason);
  await assert.rejects(execution, (error) => {
    assert.equal(error.code, 'external-gate/termination-failed');
    assert.equal(error.details.reasonCode, 'test/cancelled');
    assert.equal(error.cause.code, 'process-tree/termination-failed');
    const result = createGateResult({ gateId: 'project.example', status: 'execution-error', summary: error.message, error });
    const evidence = JSON.stringify(result.error.evidence);
    assert.match(evidence, /ENOENT/);
    assert.match(evidence, /test\/cancelled/);
    assert.doesNotMatch(evidence, /spawn taskkill/);
    assert.doesNotMatch(evidence, /cleanup-secret/);
    assert.match(result.diagnostics[0].message, /spawn taskkill ENOENT token=\[REDACTED\]/);
    assert.equal(result.diagnostics[0].redacted, true);
    return true;
  });
  assert.deepEqual(child.kills, ['SIGKILL']);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(child.unreferenced, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const failedCleanup of [false, true]) {
  test(`外部门禁累计输出上限在清理${failedCleanup ? '失败' : '成功'}时均有可追溯结果`, async () => {
    const child = childProcess();
    const execution = runExactNpmCommand(invocation(), {
      spawnProcess: () => child,
      terminateProcess: failedCleanup ? missingTaskkill : async () => {},
    });
    child.stdout.write(Buffer.alloc(700 * 1024, 'x'));
    child.stderr.write(Buffer.alloc(400 * 1024, 'y'));
    await assert.rejects(execution, (error) => {
      assert.equal(error.code, failedCleanup
        ? 'external-gate/termination-failed'
        : 'external-gate/output-limit-exceeded');
      if (failedCleanup) assert.equal(error.details.reasonCode, 'external-gate/output-limit-exceeded');
      return true;
    });
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
    assert.equal(child.unreferenced, true);
  });
}

test('外部执行启动失败不依赖 close 事件，并隔离原始系统错误', async () => {
  const child = childProcess();
  child.pid = undefined;
  const execution = runExactNpmCommand(invocation(), { spawnProcess: () => child });
  child.emit('error', Object.assign(new TypeError('测试启动失败'), { code: 'ENOENT' }));
  await assert.rejects(execution, (error) => {
    assert.equal(error.code, 'external-gate/process-start-failed');
    assert.match(error.message, /无法启动/);
    assert.equal(error.cause.code, 'ENOENT');
    return true;
  });
  assert.equal(child.stdout.destroyed, true);
});

test('外部执行取消成功时保留调用方取消原因', async () => {
  const child = childProcess();
  const controller = new AbortController();
  const reason = cancellationError('test/cancelled', '测试取消外部执行');
  const execution = runExactNpmCommand(invocation(controller.signal), {
    spawnProcess: () => child, terminateProcess: async () => {},
  });
  controller.abort(reason);
  await assert.rejects(execution, (error) => error === reason);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('调用方原始英文取消原因仅进入已脱敏诊断', async () => {
  const child = childProcess();
  const controller = new AbortController();
  const reason = new TypeError('cancel execution token=cancel-secret');
  const execution = runExactNpmCommand(invocation(controller.signal), {
    spawnProcess: () => child, terminateProcess: missingTaskkill,
  });
  controller.abort(reason);
  await assert.rejects(execution, (error) => {
    const result = createGateResult({ gateId: 'project.example', status: 'execution-error', summary: error.message, error });
    assert.doesNotMatch(JSON.stringify(result.error.evidence), /cancel execution/);
    const diagnostic = result.diagnostics.find(({ source }) => source === 'process-cancellation');
    assert.match(diagnostic.message, /cancel execution token=\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(result), /cancel-secret|cleanup-secret/);
    return true;
  });
});

test('已取消的外部执行不会启动 npm', async () => {
  const controller = new AbortController();
  const reason = cancellationError('test/already-cancelled', '测试调用已取消');
  controller.abort(reason);
  await assert.rejects(runExactNpmCommand(invocation(controller.signal), {
    spawnProcess() { assert.fail('已取消的调用不得创建进程'); },
  }), (error) => error === reason);
});

test('外部执行正常退出仍对输出脱敏', async () => {
  const child = childProcess();
  const execution = runExactNpmCommand(invocation(), { spawnProcess: () => child });
  child.stdout.write('token=do-not-leak\n');
  child.stderr.write('password=hidden-password\n');
  child.emit('close', 0, null);
  const result = await execution;
  assert.equal(result.status, 0);
  assert.match(result.stdout, /token=\[REDACTED\]/);
  assert.doesNotMatch(result.stdout, /do-not-leak/);
  assert.doesNotMatch(result.stderr, /hidden-password/);
});

test('实际有限 npm 子进程能正常结束', async () => {
  const execution = await runExactNpmCommand(invocation());
  assert.equal(execution.status, 0);
  assert.match(execution.stdout, /\d+\.\d+\.\d+/);
});
