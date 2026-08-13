import assert from 'node:assert/strict';
import test from 'node:test';
import { defineExecutionPlan } from '../src/core/capability/execution-plan.js';
import { defineGate } from '../src/core/capability/gate-definition.js';
import { createGateRegistry } from '../src/core/capability/gate-registry.js';
import {
  createChangeSet,
  createGateContext,
} from '../src/core/capability/gate-context.js';
import { createGateResult } from '../src/core/result/gate-result.js';
import { orchestratePlan } from '../src/orchestration/orchestrator.js';

function gate(id) {
  return defineGate({
    id,
    environments: ['ci-full', 'pre-push'],
    mutation: 'read-only',
    defaultTimeoutMs: 1000,
    inspectSetup: () => null,
    plan: () => ({}),
    run: () => null,
  });
}

function result(gateId, status) {
  return createGateResult({
    gateId,
    status,
    summary: `${gateId} ${status}`,
    error: status.endsWith('-error') ? new Error(`${gateId} failed`) : null,
  });
}

function fixture(environment) {
  const registry = createGateRegistry([gate('first'), gate('second'), gate('third')]);
  const plan = defineExecutionPlan({
    id: environment,
    environment,
    steps: ['first', 'second', 'third'],
  });
  const changes = createChangeSet({
    source: environment,
    changes: [{ status: 'M', oldPath: null, path: 'src/example.js' }],
    revision: { base: 'base', head: 'head' },
  });
  const context = createGateContext({
    root: 'C:/repo',
    environment,
    config: Object.freeze({ version: 1 }),
    changes,
    files: ['src/example.js'],
  });
  return { context, plan, registry };
}

test('creates immutable GateContext and ChangeSet values', () => {
  const { context } = fixture('ci-full');
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.changes), true);
  assert.equal(Object.isFrozen(context.changes.entries), true);
  assert.equal(Object.isFrozen(context.changes.entries[0]), true);
  assert.equal(Object.isFrozen(context.config), true);
  assert.deepEqual(context.revision, { base: 'base', head: 'head' });
  assert.equal(context.signal instanceof AbortSignal, true);
  assert.deepEqual(context.files, ['src/example.js']);
});

test('aggregates all CI results and maps execution errors ahead of violations', async () => {
  const fixtureValue = fixture('ci-full');
  const visited = [];
  const statuses = {
    first: 'violation',
    second: 'passed',
    third: 'execution-error',
  };
  const receivedChangeSets = [];
  const execution = await orchestratePlan({
    ...fixtureValue,
    executeStep: async ({ context, step }) => {
      visited.push(step.id);
      receivedChangeSets.push(context.changes);
      return result(step.id, statuses[step.id]);
    },
  });
  assert.deepEqual(visited, ['first', 'second', 'third']);
  assert.equal(receivedChangeSets.every((value) => value === fixtureValue.context.changes), true);
  assert.equal(execution.status, 'execution-error');
  assert.equal(execution.exitCode, 1);
});

test('stops pre-push at the first failure and uses the unified status exit code', async () => {
  const fixtureValue = fixture('pre-push');
  const visited = [];
  const execution = await orchestratePlan({
    ...fixtureValue,
    stopOnFailure: true,
    executeStep: ({ step }) => {
      visited.push(step.id);
      return step.id === 'second'
        ? result(step.id, 'violation')
        : result(step.id, 'passed');
    },
  });
  assert.deepEqual(visited, ['first', 'second']);
  assert.equal(execution.status, 'violation');
  assert.equal(execution.exitCode, 2);
});

test('enforces gate timeouts and forwards the same cancellation signal to a step', async () => {
  const fixtureValue = fixture('ci-full');
  const timedGate = defineGate({
    ...fixtureValue.registry.get('first'),
    id: 'timed',
    defaultTimeoutMs: 10,
  });
  const registry = createGateRegistry([timedGate]);
  const plan = defineExecutionPlan({
    id: 'timed',
    environment: 'ci-full',
    steps: ['timed'],
  });
  let receivedSignal;
  const execution = await orchestratePlan({
    plan,
    registry,
    context: fixtureValue.context,
    executeStep: ({ context }) => {
      receivedSignal = context.signal;
      return new Promise(() => {});
    },
  });
  assert.equal(receivedSignal instanceof AbortSignal, true);
  assert.equal(receivedSignal.aborted, true);
  assert.equal(execution.status, 'execution-error');
  assert.match(execution.decisiveResult.error.message, /exceeded its 10ms timeout/);
});

test('waits for cancellation-capable gates to finish cleanup after a timeout', async () => {
  const fixtureValue = fixture('ci-full');
  const timedGate = defineGate({
    ...fixtureValue.registry.get('first'),
    id: 'timed-cleanup',
    defaultTimeoutMs: 10,
    supportsCancellation: true,
  });
  const registry = createGateRegistry([timedGate]);
  const plan = defineExecutionPlan({
    id: 'timed-cleanup',
    environment: 'ci-full',
    steps: ['timed-cleanup'],
  });
  let cleaned = false;
  const execution = await orchestratePlan({
    plan,
    registry,
    context: fixtureValue.context,
    executeStep: ({ context }) => new Promise((resolve, reject) => {
      context.signal.addEventListener('abort', () => {
        setTimeout(() => {
          cleaned = true;
          reject(context.signal.reason);
        }, 20);
      }, { once: true });
    }),
  });
  assert.equal(cleaned, true);
  assert.equal(execution.status, 'execution-error');
  assert.match(execution.decisiveResult.error.message, /exceeded its 10ms timeout/);
});

test('does not accept a passing result returned after cancellation', async () => {
  const fixtureValue = fixture('ci-full');
  const timedGate = defineGate({
    ...fixtureValue.registry.get('first'),
    id: 'timed-late-pass',
    defaultTimeoutMs: 10,
    supportsCancellation: true,
  });
  const registry = createGateRegistry([timedGate]);
  const plan = defineExecutionPlan({
    id: 'timed-late-pass',
    environment: 'ci-full',
    steps: ['timed-late-pass'],
  });
  const execution = await orchestratePlan({
    plan,
    registry,
    context: fixtureValue.context,
    executeStep: ({ context }) => new Promise((resolve) => {
      context.signal.addEventListener('abort', () => {
        setTimeout(() => resolve(result('timed-late-pass', 'passed')), 20);
      }, { once: true });
    }),
  });
  assert.equal(execution.status, 'execution-error');
  assert.match(execution.decisiveResult.error.message, /exceeded its 10ms timeout/);
});

test('honors an upstream cancellation before starting an asynchronous step', async () => {
  const fixtureValue = fixture('ci-full');
  const controller = new AbortController();
  controller.abort(new Error('cancelled by caller'));
  const context = Object.freeze({ ...fixtureValue.context, signal: controller.signal });
  let invoked = false;
  const execution = await orchestratePlan({
    ...fixtureValue,
    context,
    stopOnFailure: true,
    executeStep: () => {
      invoked = true;
      return result('first', 'passed');
    },
  });
  assert.equal(invoked, false);
  assert.equal(execution.status, 'execution-error');
  assert.match(execution.decisiveResult.error.message, /cancelled by caller/);
});

test('classifies setup failures before executing a gate body', async () => {
  const fixtureValue = fixture('ci-full');
  const invalidGate = defineGate({
    ...fixtureValue.registry.get('first'),
    id: 'invalid',
    inspectSetup: () => ({ status: 'invalid', summary: 'missing project tool' }),
  });
  const registry = createGateRegistry([invalidGate]);
  const plan = defineExecutionPlan({
    id: 'invalid',
    environment: 'ci-full',
    steps: ['invalid'],
  });
  let invoked = false;
  const execution = await orchestratePlan({
    plan,
    registry,
    context: fixtureValue.context,
    executeStep: () => {
      invoked = true;
      return result('invalid', 'passed');
    },
  });
  assert.equal(invoked, false);
  assert.equal(execution.status, 'configuration-error');
  assert.equal(execution.exitCode, 1);
  assert.match(execution.decisiveResult.error.message, /missing project tool/);
});

test('rejects results that do not belong to the executing gate', async () => {
  const fixtureValue = fixture('ci-full');
  const execution = await orchestratePlan({
    ...fixtureValue,
    stopOnFailure: true,
    executeStep: () => result('another-gate', 'passed'),
  });
  assert.equal(execution.status, 'execution-error');
  assert.match(execution.decisiveResult.error.message, /returned a result for another-gate/);
});
