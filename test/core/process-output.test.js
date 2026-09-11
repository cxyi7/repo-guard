import test from 'node:test';
import assert from 'node:assert/strict';
import { processOutputDiagnostics } from '../../src/core/execution/process-output.js';

test('空输出也保留原始退出码；超时和信号不被零码掩盖，诊断继续脱敏', () => {
  for (const status of [0, 7, 9]) {
    const diagnostics = processOutputDiagnostics({ status, stdout: '', stderr: '' });
    assert.ok(diagnostics.some(({ message }) => message.includes(`原始退出码 ${status}`)));
  }
  const timedOut = processOutputDiagnostics({ status: 0, timedOut: true, signal: 'SIGTERM' });
  assert.equal(timedOut.at(-1).level, 'error');
  assert.match(timedOut.at(-1).message, /执行超时.*SIGTERM/);
  const failed = processOutputDiagnostics({ status: null, error: { message: 'token=secret-value' } });
  assert.match(failed.at(-1).message, /进程错误/);
  assert.doesNotMatch(failed.at(-1).message, /secret-value/);
  assert.equal(failed.at(-1).redacted, true);
});
