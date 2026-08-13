import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createArtifact,
  createFinding,
  createGateResult,
  gateResultToExitCode,
  gateStatusToExitCode,
} from '../src/core/result/gate-result.js';
import { adaptLegacyRunner } from '../src/core/result/legacy-runner-adapter.js';
import { renderGateResultConsole } from '../src/core/report/console-renderer.js';
import {
  renderGateResultJson,
  renderLegacyCiStep,
} from '../src/core/report/json-renderer.js';

test('validates and freezes the unified gate result model', () => {
  const finding = createFinding({
    ruleId: 'security/example',
    severity: 'error',
    message: 'Unsafe example',
    location: { path: 'src/example.js', line: 3, column: 5 },
    evidence: 'eval(input)',
    remediation: 'Use a static parser.',
  });
  const artifact = createArtifact({
    path: 'reports/example.json',
    type: 'application/json',
  });
  const result = createGateResult({
    gateId: 'security.example',
    status: 'violation',
    summary: 'One unsafe example',
    findings: [finding],
    artifacts: [artifact],
    metrics: { checkedFiles: 4 },
    durationMs: 12,
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.findings), true);
  assert.deepEqual(result.findings[0].location, {
    path: 'src/example.js',
    line: 3,
    column: 5,
  });
  assert.equal(gateResultToExitCode(result), 2);
  assert.throws(
    () => createGateResult({ gateId: 'bad', status: 'failed', summary: 'bad' }),
    /GateResult status/,
  );
  assert.throws(
    () => createFinding({ ruleId: 'bad', severity: 'fatal', message: 'bad' }),
    /Finding severity/,
  );
});

test('maps every stable status to the existing CLI exit contract', () => {
  assert.equal(gateStatusToExitCode('passed'), 0);
  assert.equal(gateStatusToExitCode('skipped'), 0);
  assert.equal(gateStatusToExitCode('violation'), 2);
  assert.equal(gateStatusToExitCode('configuration-error'), 1);
  assert.equal(gateStatusToExitCode('execution-error'), 1);
  assert.equal(gateStatusToExitCode('range-error'), 3);
});

test('adapts legacy diagnostics and exit codes without changing console or CI shapes', async () => {
  const result = await adaptLegacyRunner({
    gateId: 'security.legacy-example',
    task: async () => {
      console.log('checked 2 files');
      console.error('unsafe call at src/example.js:3');
      return 2;
    },
  });

  assert.equal(result.status, 'violation');
  assert.equal(gateResultToExitCode(result, { preserveLegacy: true }), 2);
  assert.deepEqual(renderGateResultConsole(result, { label: 'legacy-example' }), [
    { stream: 'stdout', message: 'checked 2 files' },
    { stream: 'stderr', message: 'unsafe call at src/example.js:3' },
    { stream: 'stderr', message: 'FAIL  legacy-example' },
  ]);
  assert.deepEqual(renderLegacyCiStep(result, { name: 'legacy-example' }), {
    name: 'legacy-example',
    status: 'failed',
    exitCode: 2,
    durationMs: result.durationMs,
  });
});

test('renders one normalized result as versioned JSON', () => {
  const result = createGateResult({
    gateId: 'repository.example',
    status: 'passed',
    summary: 'Repository example passed',
    metrics: { checkedFiles: 2 },
    durationMs: 7,
  });

  assert.deepEqual(renderGateResultJson(result), {
    schemaVersion: 1,
    gateId: 'repository.example',
    status: 'passed',
    summary: 'Repository example passed',
    findings: [],
    metrics: { checkedFiles: 2 },
    artifacts: [],
    durationMs: 7,
  });
});

test('normalizes thrown legacy errors for both renderers', async () => {
  const result = await adaptLegacyRunner({
    gateId: 'quality.crashed',
    task: () => {
      console.warn('tool warning before crash');
      throw Object.assign(new Error('tool crashed'), { code: 'ETOOL' });
    },
  });

  assert.equal(result.status, 'execution-error');
  assert.equal(gateResultToExitCode(result), 1);
  assert.deepEqual(renderGateResultConsole(result, { label: 'crashed' }), [
    { stream: 'stderr', message: 'tool warning before crash' },
    { stream: 'stderr', message: 'ERROR crashed: tool crashed' },
  ]);
  assert.deepEqual(renderGateResultJson(result).error, {
    name: 'Error',
    message: 'tool crashed',
    code: 'ETOOL',
  });

  const primitiveError = await adaptLegacyRunner({
    gateId: 'quality.primitive-error',
    task: () => Promise.reject('primitive failure'),
  });
  assert.equal(primitiveError.status, 'execution-error');
  assert.equal(primitiveError.summary, 'primitive failure');
});
