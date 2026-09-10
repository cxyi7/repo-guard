import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXIT_CODES, aggregateExitCodes, aggregateGateResults, gateStatusToExitCode,
  processExecutionToStatus, repoGuardProcessToExitCode, validateExitCode,
} from '../../src/core/result/exit-code.js';

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, position) => position !== index))
    .map((rest) => [value, ...rest]));
}

test('公共退出码契约只接受已声明的状态与数字，不允许命令隐式成功', () => {
  assert.deepEqual(EXIT_CODES, { success: 0, error: 1, violation: 2, range: 3 });
  for (const value of [undefined, null, false, '0', 7, 99, -1, NaN]) {
    assert.throws(() => validateExitCode(value), /未知的 repo-guard 退出码/);
  }
  for (const status of ['failed', 'constructor', 'toString', undefined, { toString: () => 'passed' }]) {
    assert.throws(() => gateStatusToExitCode(status), /未知的 GateStatus/);
  }
});

test('混合错误的结果与退出码在任意应用排列中保持相同优先级', () => {
  const statuses = ['passed', 'skipped', 'violation', 'range-error', 'configuration-error', 'execution-error'];
  for (const order of permutations(statuses)) {
    const results = Object.freeze(order.map((status) => Object.freeze({ status })));
    const aggregate = aggregateGateResults(results);
    assert.equal(aggregate.status, 'execution-error');
    assert.equal(aggregate.exitCode, 1);
    assert.equal(aggregate.decisiveResult, results.find(({ status }) => status === 'execution-error'));
    assert.equal(aggregateExitCodes(order.map(gateStatusToExitCode)), 1);
  }
  for (const [statuses, expectedStatus, expectedCode] of [
    [['configuration-error', 'range-error', 'violation'], 'configuration-error', 1],
    [['range-error', 'violation', 'passed'], 'range-error', 3],
    [['violation', 'passed', 'skipped'], 'violation', 2],
  ]) {
    for (const order of permutations(statuses)) {
      const result = aggregateGateResults(order.map((status) => ({ status })));
      assert.equal(result.status, expectedStatus);
      assert.equal(result.exitCode, expectedCode);
      assert.equal(aggregateExitCodes(order.map(gateStatusToExitCode)), expectedCode);
    }
  }
});

test('空计划可成功，全跳过仍记录跳过，不能变成实际检查通过', () => {
  assert.deepEqual(aggregateGateResults([]), { status: 'passed', decisiveResult: null, exitCode: 0 });
  assert.equal(aggregateExitCodes([]), 0);
  assert.equal(aggregateGateResults([{ status: 'skipped' }, { status: 'skipped' }]).status, 'skipped');
  assert.equal(aggregateGateResults([{ status: 'skipped' }, { status: 'passed' }]).status, 'passed');
});

test('第三方原始退出码依领域含义分类，启动异常和信号优先于进程数字', () => {
  for (const code of [1, 2, 3, 7, 99]) {
    assert.equal(processExecutionToStatus({ status: code }), 'execution-error');
    assert.equal(processExecutionToStatus({ status: code }, { failureStatus: 'violation' }), 'violation');
  }
  assert.equal(processExecutionToStatus({ status: 0 }), 'passed');
  for (const execution of [
    { status: null }, { status: 0, timedOut: true }, { status: 0, signal: 'SIGTERM' },
    { status: 0, error: { code: 'ENOENT' } }, { status: -1 }, {},
  ]) {
    assert.equal(processExecutionToStatus(execution, { failureStatus: 'violation' }), 'execution-error');
  }
});

test('本工具子进程保留合法分类，未知状态不能泄漏为公开退出码', () => {
  for (const code of [0, 1, 2, 3]) assert.equal(repoGuardProcessToExitCode({ status: code }), code);
  for (const execution of [
    { status: 7 }, { status: 99 }, { status: null }, { status: '0' },
    { status: 2, timedOut: true }, { status: 3, signal: 'SIGTERM' }, { status: 0, error: {} },
  ]) assert.equal(repoGuardProcessToExitCode(execution), 1);
});
