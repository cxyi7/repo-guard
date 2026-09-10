import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { executionError } from '../../src/core/error/repo-guard-error.js';
import { terminateProcessTree } from '../../src/core/execution/process-tree.js';

function childProcess(pid = 1234) {
  const child = new EventEmitter();
  Object.assign(child, {
    pid, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(),
    unreferenced: false, kills: [],
    unref() { this.unreferenced = true; },
    kill(signal) { this.kills.push(signal); return true; },
  });
  return child;
}

function exit(child, status = 0) {
  child.exitCode = status;
  child.emit('exit', status, null);
}

for (const failure of ['missing', 'nonzero', 'hung']) {
  test(`Windows 进程树清理在 taskkill ${failure} 时有界失败并释放管道`, async () => {
    const child = childProcess();
    const killer = childProcess(5678);
    const started = Date.now();
    await assert.rejects(terminateProcessTree(child, {
      platform: 'win32', timeoutMs: 40,
      spawnProcess(command, argumentsList, options) {
        assert.equal(command, 'taskkill');
        assert.deepEqual(argumentsList, ['/pid', '1234', '/t', '/f']);
        assert.equal(options.windowsHide, true);
        queueMicrotask(() => {
          if (failure === 'missing') killer.emit('error', executionError('ENOENT', '测试命令不存在'));
          if (failure === 'nonzero') killer.emit('close', 5);
        });
        return killer;
      },
    }), (error) => {
      assert.equal(error.code, 'process-tree/termination-failed');
      assert.equal(error.kind, 'execution');
      return true;
    });
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(child.kills, ['SIGKILL']);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
    assert.equal(child.unreferenced, true);
    assert.equal(killer.unreferenced, true);
    assert.equal(child.listenerCount('exit'), 0);
  });
}

test('Windows 正常清理等待父进程退出，但不等待后代持有的输出管道', async () => {
  const child = childProcess();
  const killer = childProcess(5678);
  await terminateProcessTree(child, {
    platform: 'win32', timeoutMs: 500,
    spawnProcess() {
      queueMicrotask(() => {
        killer.exitCode = 0;
        killer.emit('close', 0);
        exit(child);
      });
      return killer;
    },
  });
  assert.deepEqual(child.kills, []);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.unreferenced, true);
});

test('taskkill 声称成功而目标未退出时仍有界失败', async () => {
  const child = childProcess();
  const killer = childProcess(5678);
  await assert.rejects(terminateProcessTree(child, {
    platform: 'win32', timeoutMs: 30,
    spawnProcess() {
      queueMicrotask(() => { killer.exitCode = 0; killer.emit('close', 0); });
      return killer;
    },
  }), { code: 'process-tree/termination-failed' });
  assert.deepEqual(child.kills, ['SIGKILL']);
});

test('Unix 按进程组终止并确认父进程退出', async () => {
  const child = childProcess();
  await terminateProcessTree(child, {
    platform: 'linux', timeoutMs: 500,
    killProcess(pid, signal) {
      assert.equal(pid, -child.pid);
      assert.equal(signal, 'SIGKILL');
      queueMicrotask(() => exit(child));
    },
  });
  assert.deepEqual(child.kills, []);
  assert.equal(child.stdout.destroyed, true);
});

test('Unix 进程组终止被拒绝时尽力直杀并保留失败', async () => {
  const child = childProcess();
  await assert.rejects(terminateProcessTree(child, {
    platform: 'linux', timeoutMs: 500,
    killProcess() { throw executionError('EPERM', '测试拒绝终止'); },
  }), { code: 'process-tree/termination-failed' });
  assert.deepEqual(child.kills, ['SIGKILL']);
  assert.equal(child.stderr.destroyed, true);
});
