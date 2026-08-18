import assert from 'node:assert/strict';
import test from 'node:test';
import { defineExecutionPlan } from '../src/core/capability/execution-plan.js';
import { defineGate } from '../src/core/capability/gate-definition.js';
import { createGateContext, createChangeSet } from '../src/core/capability/gate-context.js';
import { createGateRegistry } from '../src/core/capability/gate-registry.js';
import { createGateResult } from '../src/core/result/gate-result.js';
import {
  createCiGatePolicyController,
  validateCiGatePolicy,
} from '../src/orchestration/ci/gate-policy.js';
import { orchestratePlan } from '../src/orchestration/orchestrator.js';

function config(mode, scope = 'all-files') {
  return {
    version: 1,
    ci: {
      gatePolicy: {
        defaultMode: 'inherit',
        gates: { 'quality.example': { mode, scope } },
      },
    },
    externalGates: [],
    preCommit: { example: { enabled: false } },
  };
}

function fixture(mode, scope = 'all-files') {
  const observations = [];
  const gate = defineGate({
    id: 'quality.example',
    configKey: 'preCommit.example',
    environments: ['pre-commit', 'ci-full'],
    ciScopes: ['all-files', 'changed-files'],
    mutation: 'read-only',
    defaultTimeoutMs: 1000,
    inspectSetup(context) {
      observations.push({ phase: 'setup', context });
      return { status: 'ready', summary: '测试门禁已准备' };
    },
    plan(context) {
      observations.push({ phase: 'plan', context });
      return {
        enabled: context.config.preCommit.example.enabled,
        files: context.files,
      };
    },
    run({ plan: gatePlan }) {
      observations.push({ phase: 'run', plan: gatePlan });
      return createGateResult({
        gateId: 'quality.example',
        status: gatePlan.enabled ? 'violation' : 'skipped',
        summary: gatePlan.enabled ? '测试门禁发现违规' : '测试门禁已禁用',
      });
    },
  });
  const registry = createGateRegistry([gate]);
  const plan = defineExecutionPlan({
    id: 'ci-full',
    environment: 'ci-full',
    steps: ['quality.example'],
  });
  const projectConfig = config(mode, scope);
  const context = createGateContext({
    root: 'C:/repo',
    environment: 'ci-full',
    config: projectConfig,
    changes: createChangeSet({
      source: 'ci',
      changes: [{ status: 'M', path: 'src/changed.js' }],
    }),
    files: ['src/changed.js', 'src/legacy.js'],
  });
  return {
    context,
    controller: createCiGatePolicyController({
      config: projectConfig,
      registry,
      plan,
    }),
    observations,
    plan,
    projectConfig,
    registry,
  };
}

async function executeFixture(value) {
  return await orchestratePlan({
    plan: value.plan,
    registry: value.registry,
    context: value.context,
    prepareStepContext: value.controller.prepareStepContext,
    beforeStep: value.controller.beforeStep,
  });
}

test('off skips a CI Gate before setup or execution', async () => {
  const value = fixture('off');
  const execution = await executeFixture(value);

  assert.equal(execution.results[0].status, 'skipped');
  assert.deepEqual(value.observations, []);
  assert.deepEqual(value.controller.describe(value.plan.steps[0]), {
    mode: 'off',
    scope: 'all-files',
    blocking: false,
  });
});

test('report activates a disabled Gate only inside CI and never blocks CI', async () => {
  const value = fixture('report');
  const execution = await executeFixture(value);
  const evaluated = value.controller.evaluate(execution);

  assert.equal(execution.status, 'violation');
  assert.equal(evaluated.status, 'passed');
  assert.equal(evaluated.exitCode, 0);
  assert.equal(value.observations[0].context.config.preCommit.example.enabled, true);
  assert.equal(value.projectConfig.preCommit.example.enabled, false);
  assert.equal(value.context.config.preCommit.example.enabled, false);
});

test('enforce activates a disabled Gate in CI and preserves blocking failures', async () => {
  const value = fixture('enforce');
  const evaluated = value.controller.evaluate(await executeFixture(value));

  assert.equal(evaluated.status, 'violation');
  assert.equal(evaluated.exitCode, 2);
  assert.equal(value.observations.at(-1).phase, 'run');
});

test('inherit preserves the existing Gate enabled setting', async () => {
  const value = fixture('inherit');
  const evaluated = value.controller.evaluate(await executeFixture(value));

  assert.equal(evaluated.status, 'passed');
  assert.equal(evaluated.exitCode, 0);
  assert.equal(value.observations[1].context.config.preCommit.example.enabled, false);
});

test('changed-files narrows only the CI Gate file scope', async () => {
  const value = fixture('enforce', 'changed-files');
  await executeFixture(value);

  assert.deepEqual(value.observations[1].context.files, ['src/changed.js']);
  assert.deepEqual(value.context.files, ['src/changed.js', 'src/legacy.js']);
});

test('rejects unknown CI Gate ids and unsupported scopes at the Registry boundary', () => {
  const value = fixture('enforce');
  assert.throws(
    () => validateCiGatePolicy({
      ...value.projectConfig,
      ci: {
        gatePolicy: {
          defaultMode: 'inherit',
          gates: { 'quality.unknown': { mode: 'off', scope: 'all-files' } },
        },
      },
    }, value.registry),
    /未知或非 CI 门禁/,
  );
  assert.throws(
    () => createCiGatePolicyController({
      config: config('enforce', 'changed-files'),
      registry: createGateRegistry([defineGate({
        ...value.registry.get('quality.example'),
        ciScopes: ['all-files'],
      })]),
      plan: value.plan,
    }),
    /不支持 changed-files/,
  );
});
