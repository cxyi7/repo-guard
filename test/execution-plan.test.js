import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import {
  defineProtectedPreCommitPlan,
  preCommitPolicyPlan,
  preCommitQualityPlan,
} from '../src/orchestration/pre-commit/protected-plan.js';

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
      'quality.vue-async-resource-cleanup',
      'repository.path-naming',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'repository.maximum-file-lines',
      'repository.file-placement',
      'dependencies.policy',
      'repository.code-placement',
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
      'quality.vue-async-resource-cleanup',
      'repository.path-naming',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'dependencies.policy',
      'repository.file-placement',
      'repository.code-placement',
      'repository.maximum-file-lines',
      'quality.unit-test-policy',
      'repository.protected-files',
    ],
  );
  assert.deepEqual(
    executionPlans.get('ci-full').steps.map(({ id }) => id),
    [
      'repository.structured-exceptions',
      'quality.vue-async-resource-cleanup',
      'repository.path-naming',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'dependencies.policy',
      'repository.file-placement',
      'repository.code-placement',
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
  assert.deepEqual(
    executionPlans.get('release-ready').steps.map(({ id }) => id),
    [
      'repository.structured-exceptions',
      'quality.vue-async-resource-cleanup',
      'repository.path-naming',
      'security.dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'dependencies.policy',
      'repository.file-placement',
      'repository.code-placement',
      'repository.maximum-file-lines',
      'quality.unit-test-policy',
      'repository.protected-files',
      'release.check',
      'release.test',
      'quality.build',
      'quality.lighthouse',
      'release.package',
    ],
  );
  assert.equal(executionPlans.all.every((plan) => plan.locked), true);
  assert.equal(executionPlans.all.every((plan) => Object.isFrozen(plan.steps)), true);
  assert.deepEqual(
    executionPlans.get('ci-full').steps.map((step) => step.reportName ?? step.id),
    [
      'repository.structured-exceptions',
      'async-resource-cleanup',
      'path-naming',
      'dynamic-code',
      'security.vue-unsafe-html',
      'security.vue-target-blank',
      'accessibility.vue-form-label',
      'accessibility.vue-image-alt',
      'dependencies.policy',
      'repository.file-placement',
      'repository.code-placement',
      'repository.maximum-file-lines',
      'unit-test-policy',
      'protected-files',
      'stylelint',
      'eslint',
      'prettier',
      'type-check',
      'quality.unit-test',
      'quality.accessibility-test',
      'quality.architecture',
      'build',
    ],
  );

  const config = { executionOrder: ['repository.protected-files'] };
  assert.deepEqual(
    executionPlans.get('pre-commit').steps.map(({ id }) => id).slice(0, 2),
    ['quality.stylelint-fix', 'quality.eslint-fix'],
  );
  assert.deepEqual(config.executionOrder, ['repository.protected-files']);
});

test('requires every Registry-declared CI Gate to belong to a reviewed CI plan', () => {
  const ciPlans = ['ci-policy', 'ci-full', 'release-ready']
    .map((planId) => executionPlans.get(planId));
  const plannedGateIds = new Set(ciPlans.flatMap((plan) => (
    plan.steps.map(({ gateId }) => gateId)
  )));

  assert.deepEqual(
    gateRegistry.ci
      .map(({ id }) => id)
      .filter((gateId) => !plannedGateIds.has(gateId)),
    [],
  );
  for (const plan of ciPlans) {
    for (const { gateId } of plan.steps) {
      assert.equal(
        gateRegistry.ci.some(({ id }) => id === gateId),
        true,
        `${gateId} 必须由 Registry 声明为 CI Gate`,
      );
    }
  }
});

test('rejects every attempt to reorder or expand the protected pre-commit plan', () => {
  const steps = executionPlans.get('pre-commit').steps.map((step) => ({ ...step }));
  [steps[0], steps[1]] = [steps[1], steps[0]];
  assert.throws(
    () => defineProtectedPreCommitPlan({ steps }),
    /不得更改.*计划顺序和变更契约/,
  );

  const relabeled = executionPlans.get('pre-commit').steps.map((step) => ({ ...step }));
  relabeled[0].mutation = 'read-only';
  assert.throws(
    () => defineProtectedPreCommitPlan({ steps: relabeled }),
    /不得更改.*计划顺序和变更契约/,
  );

  const withTypeCheck = [
    ...executionPlans.get('pre-commit').steps,
    'quality.typecheck',
  ];
  assert.throws(
    () => defineProtectedPreCommitPlan({ steps: withTypeCheck }),
    /禁止项目级、类型检查、测试、构建和网络门禁：quality\.typecheck/,
  );

  assert.throws(
    () => defineProtectedPreCommitPlan({
      steps: [...executionPlans.get('pre-commit').steps, 'quality.lighthouse'],
    }),
    /禁止项目级、类型检查、测试、构建和网络门禁：quality\.lighthouse/,
  );

  assert.deepEqual(
    [...preCommitQualityPlan.steps, ...preCommitPolicyPlan.steps],
    executionPlans.get('pre-commit').steps,
  );
  assert.deepEqual(
    preCommitPolicyPlan.steps.map(({ id }) => id),
    ['dependencies.policy', 'repository.code-placement', 'repository.protected-files'],
  );
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
    /未知门禁/,
  );
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'wrong-order', environment: 'pre-commit', steps: ['second', 'first'] }), registry),
    /在.*first.*之前运行了 second|在.*second.*之后运行了 first/,
  );
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'missing-dependency', environment: 'pre-commit', steps: ['second'] }), registry),
    /遗漏了.*依赖 first/,
  );
  assert.throws(
    () => createExecutionPlanRegistry([valid, valid], registry),
    /执行计划 id 重复/,
  );
  assert.throws(
    () => validateExecutionPlan(defineExecutionPlan({ id: 'wrong-environment', environment: 'ci-full', steps: ['first'] }), registry),
    /不支持的环境/,
  );
  assert.throws(
    () => defineExecutionPlan({
      id: 'invalid-report-name',
      environment: 'ci-full',
      steps: [{ id: 'first', gateId: 'first', reportName: ' ' }],
    }),
    /reportName 必须是非空字符串/,
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
    /不能在.*以 working-tree-fix 运行 mutating/,
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
    /不能将 mislabeled-read 的变更级别改为 read-only/,
  );

  const managedRegistry = createGateRegistry([
    gate('managed', { environments: ['ci-policy'], mutation: 'managed-files' }),
  ]);
  assert.throws(
    () => validateExecutionPlan(
      defineExecutionPlan({ id: 'managed-policy', environment: 'ci-policy', steps: ['managed'] }),
      managedRegistry,
    ),
    /不能在.*以 managed-files 运行 managed/,
  );
});

test('rejects duplicate config keys, invalid relation references, ordering cycles, and conflicts', () => {
  assert.throws(
    () => createGateRegistry([
      gate('first', { configKey: 'shared' }),
      gate('second', { configKey: 'shared' }),
    ]),
    /门禁配置键重复/,
  );
  assert.throws(
    () => createGateRegistry([
      gate('first', { configKey: 'first', featureName: 'shared', featureOrder: 1 }),
      gate('second', { configKey: 'second', featureName: 'shared', featureOrder: 2 }),
    ]),
    /门禁功能名称重复/,
  );
  assert.throws(
    () => createGateRegistry([gate('first', { before: ['missing'] })]),
    /before 指向未知门禁/,
  );
  assert.throws(
    () => createGateRegistry([
      gate('first', { before: ['second'] }),
      gate('second', { before: ['first'] }),
    ]),
    /门禁依赖环/,
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
    /冲突门禁/,
  );
});

test('keeps capability discovery in Registry and lifecycle order in Execution Plans', () => {
  const sources = Object.fromEntries([
    'orchestration/cli/runner',
      'orchestration/doctor/runner',
    'orchestration/setup/hook-installer',
    'orchestration/ci/runner',
    'orchestration/pre-commit/quality-runner',
    'orchestration/pre-commit/runner',
    'orchestration/pre-push/runner',
  ].map((name) => [name, readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')]));

  assert.doesNotMatch(
    sources['orchestration/cli/runner'],
    /case ['"](?:dynamic-code|unsafe-html|typecheck|build)['"]/,
  );
  assert.doesNotMatch(sources['orchestration/setup/hook-installer'], /scripts\[['"]guard:(?:dynamic-code|unsafe-html|typecheck|build)['"]\]/);
    assert.match(sources['orchestration/doctor/runner'], /createProjectGateRegistry\(config\)\.all/);
  assert.match(sources['orchestration/ci/runner'], /executionPlans\.get/);
  assert.doesNotMatch(
    sources['orchestration/ci/runner'],
    /executeStep|micromatch|quality\.(?:stylelint|eslint|prettier|typecheck|unit-test|accessibility-test|architecture|build)/,
  );
  assert.match(sources['orchestration/pre-commit/quality-runner'], /plan: preCommitQualityPlan/);
  assert.doesNotMatch(
    sources['orchestration/pre-commit/quality-runner'],
    /run\w+Project|quality\.typecheck|quality\.lighthouse/,
  );
  assert.match(
    sources['orchestration/pre-commit/runner'],
    /orchestratePlan\(\{[\s\S]*plan: preCommitPolicyPlan/,
  );
  assert.doesNotMatch(
    sources['orchestration/pre-commit/runner'],
    /executeStep|unsupported-plan-step|dependencies\.policy|repository\.protected-files/,
  );
  assert.match(sources['orchestration/pre-push/runner'], /orchestratePlan\(\{[\s\S]*plan: prePushPlan/);
  assert.doesNotMatch(
    sources['orchestration/pre-push/runner'],
    /executeStep|unsupported-plan-step|quality\.(?:typecheck|unit-test|accessibility-test|architecture|build|lighthouse)/,
  );
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
