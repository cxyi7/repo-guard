import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationError, executionError } from '../src/core/error/repo-guard-error.js';
import {
  createArtifact,
  createFinding,
  createGateResult,
  gateResultToExitCode,
  gateStatusToExitCode,
} from '../src/core/result/gate-result.js';
import { renderGateResultConsole } from '../src/core/report/console-renderer.js';
import {
  renderGateResultJson,
  renderCiStep,
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
  assert.equal(Object.isFrozen(result.issues), true);
  assert.equal(result.issues[0], result.findings[0]);
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
  assert.throws(
    () => createGateResult({
      gateId: 'bad',
      status: 'execution-error',
      summary: 'bad',
      error: { name: 'Error', message: 'raw error' },
    }),
    /must be a RepoGuardError/,
  );
  assert.throws(
    () => createGateResult({
      gateId: 'bad',
      status: 'execution-error',
      summary: 'bad',
      error: configurationError('config/bad', 'bad'),
    }),
    /does not match configuration error/,
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

test('renders native violation results and CI exits', () => {
  const result = createGateResult({
    gateId: 'security.example',
    status: 'violation',
    summary: 'Unsafe call found',
    diagnostics: [
      { level: 'info', message: 'checked 2 files' },
      { level: 'error', message: 'unsafe call at src/example.js:3' },
    ],
  });

  assert.equal(result.status, 'violation');
  assert.equal(gateResultToExitCode(result), 2);
  assert.deepEqual(renderGateResultConsole(result, { label: 'example' }), [
    { stream: 'stderr', message: 'checked 2 files' },
    { stream: 'stderr', message: 'unsafe call at src/example.js:3' },
    { stream: 'stderr', message: 'FAIL  example' },
  ]);
  assert.deepEqual(renderCiStep(result, { name: 'example' }), {
    name: 'example',
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
    schemaVersion: 2,
    gateId: 'repository.example',
    status: 'passed',
    summary: 'Repository example passed',
    findings: [],
    issues: [],
    metrics: { checkedFiles: 2 },
    artifacts: [],
    diagnostics: [],
    durationMs: 7,
  });
});

test('renders structured findings without gate-owned console text', () => {
  const result = createGateResult({
    gateId: 'repository.example',
    status: 'violation',
    summary: 'Repository example failed',
    findings: [{
      ruleId: 'repository/example',
      severity: 'error',
      message: 'Example policy failed',
      location: { path: 'src/example.js', line: 3, column: 5 },
      evidence: 'The file contains a forbidden declaration.',
      remediation: 'Remove the forbidden declaration.',
    }],
  });

  const rendered = renderGateResultConsole(result, { label: 'example' });
  assert.match(rendered[0].message, /\[repository\/example\] src\/example\.js:3:5/);
  assert.ok(rendered.some(({ message }) => message === '   类型: violation'));
  assert.ok(rendered.some(({ message }) => message === '   代码: repository/example'));
  assert.ok(rendered.some(({ message }) => message.includes('证据 Evidence:')));
  assert.ok(rendered.some(({ message }) => message.includes('修复 Remediation:')));
  assert.deepEqual(rendered.at(-1), { stream: 'stderr', message: 'FAIL  example' });
  assert.deepEqual(renderGateResultJson(result).diagnostics, []);
  assert.equal(renderGateResultJson(result).findings.length, 1);
});

test('normalizes native errors for both renderers', () => {
  const result = createGateResult({
    gateId: 'quality.crashed',
    status: 'execution-error',
    summary: 'tool crashed',
    error: executionError('ETOOL', 'tool crashed'),
    diagnostics: [{ level: 'warn', message: 'tool warning before crash' }],
  });

  assert.equal(result.status, 'execution-error');
  assert.equal(gateResultToExitCode(result), 1);
  const rendered = renderGateResultConsole(result, { label: 'crashed' });
  assert.deepEqual(rendered[0], { stream: 'stderr', message: 'tool warning before crash' });
  assert.ok(rendered.some(({ message }) => message === '   类型: execution'));
  assert.ok(rendered.some(({ message }) => message === '   代码: ETOOL'));
  assert.deepEqual(rendered.at(-1), { stream: 'stderr', message: 'ERROR crashed' });
  const normalizedError = renderGateResultJson(result).error;
  assert.equal(normalizedError.name, 'RepoGuardError');
  assert.equal(normalizedError.message, 'tool crashed');
  assert.equal(normalizedError.code, 'ETOOL');
  assert.equal(normalizedError.kind, 'execution');
});
