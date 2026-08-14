import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defineGate } from '../src/core/capability/gate-definition.js';
import { createGateRegistry } from '../src/core/capability/gate-registry.js';
import { gateRegistry } from '../src/gates/registry.js';
import { dynamicCodeGate } from '../src/gates/security/dynamic-code-gate.js';

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
  assert.deepEqual(dynamicCode.allowedMutations, ['read-only']);
  assert.deepEqual(dynamicCode.environments, [
    'manual',
    'pre-commit',
    'ci-policy',
    'ci-full',
    'release-ready',
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
  assert.equal('renderConsole' in dynamicCodeGate, false);
  assert.equal('renderConsole' in dynamicCode, false);
  assert.equal(gateRegistry.findByManualCommand('dynamic-code'), dynamicCode);
  assert.deepEqual(dynamicCode.inspectSetup({ config: { version: 1 } }), {
    status: 'ready',
    summary: 'Dynamic code staged gate '
      + '(hard requirement, rules=security/no-eval+security/no-function-constructor)',
    rules: dynamicCode.rules,
  });
});

test('keeps a supplied file scope immutable without letting the gate own console output', () => {
  const sourceFile = { absolute: 'C:/repo/src/example.js', relative: 'src/example.js' };
  const plan = dynamicCodeGate.plan({ root: 'C:/repo', files: [sourceFile] });

  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.files), true);
  assert.equal(Object.isFrozen(plan.files[0]), true);
  assert.notEqual(plan.files[0], sourceFile);
  sourceFile.relative = 'src/changed.js';
  assert.equal(plan.files[0].relative, 'src/example.js');
  assert.throws(
    () => dynamicCodeGate.plan({ root: 'C:/repo' }),
    /requires an explicit file scope/,
  );
  assert.throws(
    () => dynamicCodeGate.run({ root: 'C:/repo', config: { exceptions: [] } }),
    /requires an execution plan/,
  );
});

test('enforces the migrated gate dependency boundary', () => {
  const source = readFileSync(
    new URL('../src/gates/security/dynamic-code-gate.js', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /from ['"].*renderer\.js['"]/);
  assert.doesNotMatch(source, /collectProjectFiles|collectStagedChanges|runGit/);
  assert.doesNotMatch(source, /\bconsole\.|process\.exit(?:Code)?/);
});

test('rejects duplicate identities, duplicate commands, and missing dependencies', () => {
  assert.throws(
    () => createGateRegistry([gate(), gate()]),
    /Duplicate gate id/,
  );
  assert.throws(
    () => createGateRegistry([
      gate({ id: 'first', manualCommand: 'example', manualOrder: 1 }),
      gate({ id: 'second', manualCommand: 'example', manualOrder: 2 }),
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
  assert.throws(
    () => gate({ mutation: 'working-tree-fix', allowedMutations: ['read-only'] }),
    /must include its maximum mutation/,
  );
  assert.throws(() => gate({ defaultTimeoutMs: 0 }), /positive integer/);
  assert.throws(() => gate({ run: null }), /must be functions/);
  assert.throws(() => gate({ supportsFix: 'yes' }), /must be booleans/);
  assert.throws(
    () => gate({ configKey: 'example', featureName: 'example' }),
    /requires featureOrder/,
  );
  assert.throws(
    () => gate({ manualCommand: 'example' }),
    /requires manualOrder/,
  );
});

test('records existing tool-backed capability prerequisites and side effects in Registry', () => {
  const eslint = gateRegistry.get('quality.eslint');
  assert.deepEqual(eslint.requiredTools, ['eslint']);
  assert.equal(eslint.supportsFix, true);

  const typecheck = gateRegistry.get('quality.typecheck');
  assert.equal(typecheck.defaultTimeoutMs, 180000);
  assert.equal(typecheck.mutation, 'read-only');
  assert.deepEqual(typecheck.requiredScripts, ['config:typeCheck.script']);

  const unitTest = gateRegistry.get('quality.unit-test');
  assert.deepEqual(unitTest.requiredTools, ['vitest']);
  assert.deepEqual(unitTest.requiredScripts, ['config:unitTest.script']);
  assert.deepEqual(unitTest.artifactTypes, ['coverage-report']);

  const lighthouse = gateRegistry.get('quality.lighthouse');
  assert.equal(lighthouse.defaultTimeoutMs, 300000);
  assert.equal(lighthouse.mutation, 'read-only');
  assert.deepEqual(lighthouse.requiredTools, ['@lhci/cli']);
});
