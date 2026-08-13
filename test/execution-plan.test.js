import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createExecutionPlanRegistry,
  defineExecutionPlan,
  validateExecutionPlan,
} from '../src/core/capability/execution-plan.js';
import { defineGate } from '../src/core/capability/gate-definition.js';
import { createGateRegistry } from '../src/core/capability/gate-registry.js';
import { createGateResult } from '../src/core/result/gate-result.js';
import { gateRegistry } from '../src/gates/registry.js';
import { executionPlans } from '../src/orchestration/execution-plans.js';
import { orchestratePlan } from '../src/orchestration/orchestrator.js';
import { runNativeManualGate } from '../src/orchestration/cli/manual-gates.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function gate(id, overrides = {}) {
  return defineGate({
    id,
    environments: ['pre-commit'],
    mutation: 'read-only',
    defaultTimeoutMs: 1000,
    inspectSetup: () => null,
    plan: () => ({}),
    run: () => null,
    ...overrides,
  });
}

test('locks the reviewed lifecycle order independently from project configuration', () => {
  assert.deepEqual(
    executionPlans.get('pre-commit').steps.map(({ id }) => id),
    [
      'quality.stylelint-fix',
      'quality.eslint-fix',
      'quality.prettier',
      'quality.stylelint-verify',
      'quality.eslint-verify',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'repository.maximum-file-lines',
      'repository.file-placement',
      'dependencies.policy',
      'repository.protected-files',
    ],
  );
  assert.deepEqual(
    executionPlans.get('pre-push').steps.map(({ id }) => id),
    [
      'quality.typecheck',
      'quality.unit-test',
      'quality.accessibility-test',
      'quality.architecture',
      'quality.build',
      'quality.lighthouse',
    ],
  );
  assert.deepEqual(
    executionPlans.get('ci-policy').steps.map(({ id }) => id),
    [
      'repository.structured-exceptions',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'dependencies.policy',
      'repository.file-placement',
      'repository.maximum-file-lines',
      'quality.unit-test-policy',
      'repository.protected-files',
    ],
  );
  assert.deepEqual(
    executionPlans.get('ci-full').steps.map(({ id }) => id),
    [
      'repository.structured-exceptions',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'dependencies.policy',
      'repository.file-placement',
      'repository.maximum-file-lines',
      'quality.unit-test-policy',
      'repository.protected-files',
      'quality.stylelint-project',
      'quality.eslint-project',
      'quality.prettier-project',
      'quality.typecheck',
      'quality.unit-test',
      'quality.accessibility-test',
      'quality.architecture',
      'quality.build',
    ],
  );
  assert.equal(executionPlans.all.every((plan) => plan.locked), true);
  assert.equal(executionPlans.all.every((plan) => Object.isFrozen(plan.steps)), true);

  const config = { executionOrder: ['repository.protected-files'] };
  assert.deepEqual(
    executionPlans.get('pre-commit').steps.map(({ id }) => id).slice(0, 2),
    ['quality.stylelint-fix', 'quality.eslint-fix'],
  );
  assert.deepEqual(config.executionOrder, ['repository.protected-files']);
});

test('rejects duplicate plans, unknown gates, unsupported environments, and dependency mistakes', () => {
  const first = gate('first', { before: ['second'] });
  const second = gate('second', { requires: ['first'] });
  const registry = createGateRegistry([first, second]);
  const valid = defineExecutionPlan({
    id: 'valid',
    environment: 'pre-commit',
    steps: ['first', 'second'],
  });
  assert.equal(validateExecutionPlan(valid, registry), valid);
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'unknown', environment: 'pre-commit', steps: ['missing'] }), registry),
    /Unknown gate/,
  );
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'wrong-order', environment: 'pre-commit', steps: ['second', 'first'] }), registry),
    /runs second before first|runs first after second/,
  );
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'missing-dependency', environment: 'pre-commit', steps: ['second'] }), registry),
    /omits dependency first/,
  );
  assert.throws(
    () => createExecutionPlanRegistry([valid, valid], registry),
    /Duplicate execution plan id/,
  );
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'wrong-environment', environment: 'ci-full', steps: ['first'] }), registry),
    /unsupported environment/,
  );
  const mutatingRegistry = createGateRegistry([
    gate('mutating', {
      environments: ['ci-full'],
      mutation: 'working-tree-fix',
      allowedMutations: ['working-tree-fix', 'read-only'],
    }),
  ]);
  assert.throws(
    () => validateExecutionPlan(
      defineExecutionPlan({ id: 'unsafe-ci', environment: 'ci-full', steps: ['mutating'] }),
      mutatingRegistry,
    ),
    /cannot run mutating with working-tree-fix/,
  );
  assert.doesNotThrow(() => validateExecutionPlan(
    defineExecutionPlan({
      id: 'verified-ci',
      environment: 'ci-full',
      steps: [{ id: 'mutating-verify', gateId: 'mutating', mutation: 'read-only' }],
    }),
    mutatingRegistry,
  ));
  const mislabeledRegistry = createGateRegistry([
    gate('mislabeled', { environments: ['ci-full'], mutation: 'working-tree-fix' }),
  ]);
  assert.throws(
    () => validateExecutionPlan(
      defineExecutionPlan({
        id: 'mislabeled-ci',
        environment: 'ci-full',
        steps: [{ id: 'mislabeled-read', gateId: 'mislabeled', mutation: 'read-only' }],
      }),
      mislabeledRegistry,
    ),
    /cannot relabel mislabeled-read as read-only/,
  );

  const managedRegistry = createGateRegistry([
    gate('managed', { environments: ['ci-policy'], mutation: 'managed-files' }),
  ]);
  assert.throws(
    () => validateExecutionPlan(
      defineExecutionPlan({ id: 'managed-policy', environment: 'ci-policy', steps: ['managed'] }),
      managedRegistry,
    ),
    /cannot run managed with managed-files/,
  );
});

test('rejects duplicate config keys, invalid relation references, ordering cycles, and conflicts', () => {
  assert.throws(
    () => createGateRegistry([
      gate('first', { configKey: 'shared' }),
      gate('second', { configKey: 'shared' }),
    ]),
    /Duplicate gate config key/,
  );
  assert.throws(
    () => createGateRegistry([
      gate('first', { configKey: 'first', featureName: 'shared', featureOrder: 1 }),
      gate('second', { configKey: 'second', featureName: 'shared', featureOrder: 2 }),
    ]),
    /Duplicate gate feature name/,
  );
  assert.throws(
    () => createGateRegistry([gate('first', { before: ['missing'] })]),
    /before unknown gate/,
  );
  assert.throws(
    () => createGateRegistry([
      gate('first', { before: ['second'] }),
      gate('second', { before: ['first'] }),
    ]),
    /cycle/,
  );
  const conflictRegistry = createGateRegistry([
    gate('first', { conflicts: ['second'] }),
    gate('second'),
  ]);
  assert.throws(
    () => validateExecutionPlan(
      defineExecutionPlan({ id: 'conflict', environment: 'pre-commit', steps: ['first', 'second'] }),
      conflictRegistry,
    ),
    /conflicting gates/,
  );
});

test('keeps capability discovery in Registry and lifecycle order in Execution Plans', () => {
  const sources = Object.fromEntries([
    'cli',
    'commands/doctor',
    'hook-installer',
    'ci-runner',
    'quality-runner',
    'commands/pre-push',
  ].map((name) => [name, readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')]));

  assert.doesNotMatch(sources.cli, /case ['"](?:dynamic-code|unsafe-html|typecheck|build)['"]/);
  assert.doesNotMatch(sources['hook-installer'], /scripts\[['"]guard:(?:dynamic-code|unsafe-html|typecheck|build)['"]\]/);
  assert.match(sources['commands/doctor'], /gateRegistry\.all/);
  assert.match(sources['ci-runner'], /executionPlans\.get/);
  assert.match(sources['quality-runner'], /preCommitPlan\.steps/);
  assert.match(sources['commands/pre-push'], /orchestratePlan\(\{[\s\S]*plan: prePushPlan/);
  assert.equal(gateRegistry.all.length >= 20, true);
  assert.equal(gateRegistry.configurable.length > 0, true);
  assert.equal(gateRegistry.findByConfigKey('typeCheck')?.id, 'quality.typecheck');
});

test('executes a newly registered native read-only gate without a lifecycle-specific adapter', async () => {
  const contexts = [];
  const nativeGate = gate('example.native', {
    inspectSetup: (context) => {
      contexts.push(context);
      return { status: 'ready', summary: 'ready' };
    },
    plan: (context) => Object.freeze({ files: Object.freeze([...context.files]) }),
    run: ({ plan }) => {
      contexts.push(plan);
      return createGateResult({
        gateId: 'example.native',
        status: 'passed',
        summary: 'example native passed',
      });
    },
  });
  const registry = createGateRegistry([nativeGate]);
  const plan = defineExecutionPlan({
    id: 'example-native',
    environment: 'pre-commit',
    steps: [nativeGate.id],
  });
  const context = Object.freeze({ root: 'C:/repo', files: Object.freeze(['src/a.js']) });
  const execution = await orchestratePlan({ plan, registry, context });

  assert.equal(execution.status, 'passed');
  assert.equal(contexts[0].files, context.files);
  assert.deepEqual(contexts[1].files, ['src/a.js']);
});

test('runs an asynchronous native manual gate through setup, plan, renderer, and status mapping', async (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'native-manual-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  writeFileSync(path.join(root, 'repo-guard.config.json'), `${JSON.stringify({
    version: 1,
    rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
  })}\n`);
  writeFileSync(path.join(root, 'example.js'), 'export const value = 1;\n');
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);

  const calls = [];
  const nativeGate = gate('example.manual-native', {
    environments: ['manual'],
    manualCommand: 'manual-native',
    manualOrder: 1,
    inspectSetup: async (gateContext) => {
      calls.push(['setup', gateContext.environment]);
      return { status: 'ready', summary: 'ready' };
    },
    plan: async (gateContext) => {
      calls.push(['plan', gateContext.files.includes('example.js')]);
      return Object.freeze({ count: gateContext.files.length });
    },
    run: async ({ plan }) => {
      calls.push(['run', plan.count]);
      return {
        gateId: 'example.manual-native',
        status: 'passed',
        summary: 'native manual passed',
        findings: [],
        artifacts: [],
        metrics: {},
        durationMs: 0,
        error: null,
        diagnostics: [],
      };
    },
    renderConsole: () => [],
  });

  assert.equal((await runNativeManualGate(nativeGate, root)).status, 'passed');
  assert.deepEqual(calls.map(([name]) => name), ['setup', 'plan', 'run']);
  assert.equal(calls[0][1], 'manual');
  assert.equal(calls[1][1], true);
});
