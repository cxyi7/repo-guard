import assert from 'node:assert/strict';
import test from 'node:test';
import { defineGate } from '../src/core/capability/gate-definition.js';
import { createGateRegistry } from '../src/core/capability/gate-registry.js';
import { gateRegistry } from '../src/gates/registry.js';

function gate(overrides = {}) {
  return defineGate({
    id: 'example.gate',
    environments: ['manual'],
    mutation: 'read-only',
    defaultTimeoutMs: 1000,
    inspectSetup: () => ({ status: 'ready' }),
    plan: () => ({}),
    run: () => null,
    ...overrides,
  });
}

test('defines immutable gate metadata and exposes the dynamic-code vertical slice', () => {
  const dynamicCode = gateRegistry.get('security.dynamic-code');
  assert.equal(Object.isFrozen(dynamicCode), true);
  assert.equal(dynamicCode.manualCommand, 'dynamic-code');
  assert.equal(dynamicCode.packageScript, 'guard:dynamic-code');
  assert.equal(dynamicCode.mutation, 'read-only');
  assert.deepEqual(dynamicCode.environments, [
    'manual',
    'pre-commit',
    'ci-policy',
    'ci-full',
  ]);
  assert.deepEqual(dynamicCode.rules, [
    'security/no-eval',
    'security/no-function-constructor',
  ]);
  assert.deepEqual(dynamicCode.requiredTools, []);
  assert.deepEqual(dynamicCode.requiredScripts, []);
  assert.deepEqual(dynamicCode.requiredEnvironment, []);
  assert.deepEqual(dynamicCode.requiredSecrets, []);
  assert.deepEqual(dynamicCode.artifactTypes, []);
  assert.equal(dynamicCode.supportsFix, false);
  assert.equal(dynamicCode.supportsCancellation, false);
  assert.equal(gateRegistry.findByManualCommand('dynamic-code'), dynamicCode);
  assert.deepEqual(dynamicCode.inspectSetup({ config: { version: 1 } }), {
    status: 'ready',
    summary: 'Dynamic code staged gate '
      + '(hard requirement, rules=security/no-eval+security/no-function-constructor)',
    rules: dynamicCode.rules,
  });
});

test('rejects duplicate identities, duplicate commands, and missing dependencies', () => {
  assert.throws(
    () => createGateRegistry([gate(), gate()]),
    /Duplicate gate id/,
  );
  assert.throws(
    () => createGateRegistry([
      gate({ id: 'first', manualCommand: 'example' }),
      gate({ id: 'second', manualCommand: 'example' }),
    ]),
    /Duplicate gate manual command/,
  );
  assert.throws(
    () => createGateRegistry([gate({ requires: ['missing.gate'] })]),
    /requires unknown gate/,
  );
  assert.throws(
    () => createGateRegistry([
      gate({ id: 'first', requires: ['second'] }),
      gate({ id: 'second', requires: ['first'] }),
    ]),
    /dependency cycle/,
  );
});

test('validates gate lifecycle, mutation, timeout, and handlers', () => {
  assert.throws(() => gate({ environments: ['runtime'] }), /unsupported value/);
  assert.throws(() => gate({ mutation: 'network' }), /Gate mutation/);
  assert.throws(() => gate({ defaultTimeoutMs: 0 }), /positive integer/);
  assert.throws(() => gate({ run: null }), /must be functions/);
  assert.throws(() => gate({ supportsFix: 'yes' }), /must be booleans/);
});
