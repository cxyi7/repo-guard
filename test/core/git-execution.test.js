import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { runGit, runGitBinary } from '../../src/git/execution.js';
import { createGateResult } from '../../src/core/result/gate-result.js';
import { renderGateResultConsole } from '../../src/core/report/console-renderer.js';
import { renderGateResultJson } from '../../src/core/report/json-renderer.js';
import { processOutputLimit } from '../../src/core/execution/output-safety.js';

function captureFailure(run) {
  let captured;
  assert.throws(run, (error) => {
    captured = error;
    return true;
  });
  return captured;
}

function mockGit(context, result) {
  context.mock.method(childProcess, 'spawnSync', () => result);
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

function renderError(error) {
  const result = createGateResult({
    gateId: 'repository.example',
    status: 'execution-error',
    summary: error.message,
    error,
  });
  return {
    console: renderGateResultConsole(result).map(({ message }) => message).join('\n'),
    json: renderGateResultJson(result),
  };
}

for (const [mode, run, prefix] of [
  ['文本', runGit, 'git/'],
  ['二进制', runGitBinary, 'git/binary-'],
]) {
  test(`${mode} Git 的真实失败以中文说明并单独呈现第三方诊断`, () => {
    const error = captureFailure(() => run(['rev-parse', '--verify', 'refs/repo-guard/nonexistent-diagnostic-fixture']));
    assert.equal(error.code, `${prefix}command-failed`);
    assert.match(error.message, /^Git 命令未能成功完成/);
    assert.ok(error.details.status > 0);
    assert.equal(error.details.signal, null);
    const diagnostic = error.details.diagnostics.find(({ stream }) => stream === 'stderr');
    assert.ok(diagnostic.message.length > 0);
    assert.notEqual(error.message, diagnostic.message.trim());
    assert.match(error.expected, /成功完成/);
    assert.match(error.remediation.goal, /恢复/);
    const rendered = renderError(error);
    assert.match(rendered.console, /问题: Git 命令未能成功完成/);
    assert.match(rendered.console, /第三方原始诊断（git stderr）/);
    assert.ok(rendered.json.diagnostics.some(({ source, stream, message }) => source === 'git'
      && stream === 'stderr' && message === diagnostic.message));
    assert.ok(rendered.json.error.evidence.every(({ message }) => !message.includes(diagnostic.message.trim())));
  });

  test(`${mode} Git 启动失败保留机器原因而不把原始错误当主说明`, (context) => {
    const cause = Object.assign(new TypeError('spawn git ENOENT password=fake-start-secret'), { code: 'ENOENT' });
    mockGit(context, { error: cause, status: null, signal: null, stdout: null, stderr: null });
    const error = captureFailure(() => run(['status']));
    assert.equal(error.code, `${prefix}process-start-failed`);
    assert.equal(error.cause, cause);
    assert.equal(error.details.status, null);
    assert.equal(error.details.processCode, 'ENOENT');
    assert.match(error.message, /^Git 命令进程未能正常执行/);
    const rendered = renderError(error);
    assert.match(rendered.console, /第三方原始诊断（git:process stderr）/);
    assert.match(rendered.console, /ENOENT/);
    assert.ok(rendered.json.diagnostics.some(({ source, redacted }) => source === 'git:process' && redacted));
    assert.doesNotMatch(JSON.stringify(rendered.json.error), /spawn git ENOENT/);
    assert.doesNotMatch(`${rendered.console}\n${JSON.stringify(rendered.json)}\n${JSON.stringify(error.details)}`, /fake-start-secret/);
  });

  test(`${mode} Git 的诊断同时保留两个流和信号且脱敏限长`, (context) => {
    const stdout = `token=fake-output-secret\n${'x'.repeat(processOutputLimit + 10)}`;
    const stderr = 'fatal: password=fake-error-secret';
    mockGit(context, {
      status: null,
      signal: 'SIGTERM',
      stdout: mode === '二进制' ? Buffer.from(stdout) : stdout,
      stderr: mode === '二进制' ? Buffer.from(stderr) : stderr,
    });
    const error = captureFailure(() => run(['show']));
    assert.equal(error.details.status, null);
    assert.equal(error.details.signal, 'SIGTERM');
    const diagnostic = error.details.diagnostics.find(({ stream }) => stream === 'stdout');
    assert.match(diagnostic.message, /TRUNCATED/);
    assert.ok(Buffer.byteLength(diagnostic.message) < processOutputLimit + 100);
    assert.equal(diagnostic.truncated, true);
    assert.equal(diagnostic.redacted, true);
    const rendered = renderError(error);
    const outputs = `${rendered.console}\n${JSON.stringify(rendered.json)}\n${JSON.stringify(error.details)}`;
    assert.doesNotMatch(outputs, /fake-output-secret|fake-error-secret/);
    assert.match(outputs, /SIGTERM/);
    assert.match(outputs, /第三方原始诊断（git stdout）/);
    assert.match(outputs, /第三方原始诊断（git stderr）/);
    assert.ok(rendered.json.diagnostics.some(({ stream, truncated, redacted }) => stream === 'stdout' && truncated && redacted));
    assert.doesNotMatch(JSON.stringify(rendered.json.error), /fatal:/);
  });

  test(`${mode} Git 的 allowFailure 继续返回调用者需要的原始内容`, (context) => {
    const stdout = mode === '二进制' ? Buffer.from([0, 255, 10]) : 'token=fake-raw-output';
    const stderr = mode === '二进制' ? Buffer.from('password=fake-raw-error') : 'password=fake-raw-error';
    mockGit(context, { status: 128, signal: null, stdout, stderr });
    assert.deepEqual(run(['show'], { allowFailure: true }), { status: 128, stdout, stderr });
  });

  test(`${mode} Git 的 allowFailure 不得把信号终止或缺失退出状态当成正常失败`, (context) => {
    let execution = { status: null, signal: 'SIGTERM', stdout: null, stderr: null };
    context.mock.method(childProcess, 'spawnSync', () => execution);
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    for (const result of [
      execution,
      { status: null, signal: null, stdout: null, stderr: null },
      { status: 0, signal: 'SIGTERM', stdout: null, stderr: null },
    ]) {
      execution = result;
      const error = captureFailure(() => run(['show'], { allowFailure: true }));
      assert.equal(error.kind, 'execution');
      assert.equal(error.details.status, result.status);
      assert.equal(error.details.signal, result.signal);
    }
  });
}
