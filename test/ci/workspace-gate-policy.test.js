import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { defineExecutionPlan } from '../../src/core/capability/execution-plan.js';
import { defineGate } from '../../src/core/capability/gate-definition.js';
import { createChangeSet, createGateContext } from '../../src/core/capability/gate-context.js';
import { createGateRegistry } from '../../src/core/capability/gate-registry.js';
import { createGateResult } from '../../src/core/result/gate-result.js';
import { createCiGatePolicyController } from '../../src/orchestration/ci/gate-policy.js';
import { orchestratePlan } from '../../src/orchestration/orchestrator.js';

function gate(id, configKey, executions) {
  return defineGate({
    id, configKey, environments: ['ci-full'], ciScopes: ['all-files'],
    mutation: 'read-only', defaultTimeoutMs: 1000,
    inspectSetup() { return { status: 'ready', summary: '测试门禁已准备' }; },
    plan(context) {
      return { enabled: context.config.checks[configKey.split('.')[1]].enabled };
    },
    run({ plan }) {
      executions.push({ id, enabled: plan.enabled });
      return createGateResult({ gateId: id, status: plan.enabled ? 'violation' : 'skipped',
        summary: plan.enabled ? '测试门禁发现违规' : '测试门禁已关闭' });
    },
  });
}

async function executePolicy({ enabled = false } = {}) {
  const shared = { ci: { enabled: true, gatePolicy: {
    gates: { 'quality.typecheck': { mode: 'off' } },
  } } };
  const document = {
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' },
    checks: { typeCheck: { enabled }, build: { enabled: true } },
    ci: { gatePolicy: {
      gates: { 'quality.build': { mode: 'off' } },
    } },
  };
  const inputs = structuredClone({ document, shared });
  const config = normalizeProjectDocument(document, { shared });
  const executions = [];
  const registry = createGateRegistry([
    gate('quality.typecheck', 'checks.typeCheck', executions),
    gate('quality.build', 'checks.build', executions),
  ]);
  const plan = defineExecutionPlan({ id: 'ci-full', environment: 'ci-full',
    steps: ['quality.typecheck', 'quality.build'] });
  const controller = createCiGatePolicyController({ config, registry, plan });
  const execution = await orchestratePlan({ registry, plan,
    context: createGateContext({ root: process.cwd(), environment: 'ci-full', config,
      changes: createChangeSet({ source: 'ci', changes: [] }) }),
    prepareStepContext: controller.prepareStepContext, beforeStep: controller.beforeStep,
  });
  assert.deepEqual({ document, shared }, inputs);
  assert.equal(config.checks.typeCheck.enabled, enabled);
  assert.equal(config.checks.build.enabled, true);
  assert.deepEqual(config.ci.gatePolicy.gates, { 'quality.build': { mode: 'off', scope: 'all-files' } });
  assert.equal(execution.results[1].status, 'skipped');
  return { executions, execution, evaluated: controller.evaluate(execution) };
}

test('应用开关独立：根的关闭项不覆盖应用，应用关闭构建不影响类型检查', async () => {
  const result = await executePolicy({ enabled: true });
  assert.deepEqual(result.executions, [{ id: 'quality.typecheck', enabled: true }]);
  assert.equal(result.evaluated.exitCode, 2);
});
test('项目关闭的类型检查不被 CI 重新开启', async () => {
  const result = await executePolicy({ enabled: false });
  assert.deepEqual(result.executions, [{ id: 'quality.typecheck', enabled: false }]);
  assert.equal(result.evaluated.exitCode, 0);
});
