import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredGateTimeout } from '../../src/orchestration/gate-timeout.js';
import { defineGate } from '../../src/core/capability/gate-definition.js';
import { createGateRegistry } from '../../src/core/capability/gate-registry.js';
import { defineExecutionPlan } from '../../src/core/capability/execution-plan.js';
import { orchestratePlan } from '../../src/orchestration/orchestrator.js';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';

test('配置的执行时限覆盖默认值，非法时限不会溢出为一毫秒', () => {
  const gate = { id: 'example', configKey: 'checks.example', defaultTimeoutMs: 1000 };
  assert.equal(configuredGateTimeout(gate, { config: {} }), 1000);
  assert.equal(configuredGateTimeout(gate, { config: { checks: { example: { timeoutMs: 600000 } } } }), 600000);
  for (const timeoutMs of [0, -1, Infinity, 2147483648, '500']) {
    assert.throws(() => configuredGateTimeout(gate, { config: { checks: { example: { timeoutMs } } } }));
  }
});

test('编排器在应用配置时限到达后取消工具并保留统一执行错误', async () => {
  let signal;
  const gate = defineGate({
    id: 'example', configKey: 'checks.example', environments: ['manual'],
    mutation: 'read-only', defaultTimeoutMs: 300000,
    inspectSetup: () => null, plan: () => ({}),
    run: (context) => { signal = context.signal; return new Promise(() => {}); },
  });
  const result = await orchestratePlan({
    registry: createGateRegistry([gate]),
    plan: defineExecutionPlan({ id: 'timeout', environment: 'manual', steps: ['example'] }),
    context: { config: { checks: { example: { timeoutMs: 10 } } } },
  });
  assert.equal(signal.aborted, true);
  assert.equal(result.exitCode, EXIT_CODES.error);
  assert.equal(result.decisiveResult.error.code, 'orchestration/gate-timeout');
  assert.match(result.decisiveResult.summary, /10ms/);
});
