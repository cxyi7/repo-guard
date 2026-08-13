import { gateResultToExitCode } from '../result/gate-result.js';

const CI_STATUS = Object.freeze({
  passed: 'passed',
  skipped: 'skipped',
  violation: 'failed',
  'configuration-error': 'error',
  'execution-error': 'error',
  'range-error': 'error',
});

export function renderGateResultJson(result) {
  const report = {
    schemaVersion: 1,
    gateId: result.gateId,
    status: result.status,
    summary: result.summary,
    findings: result.findings,
    metrics: result.metrics,
    artifacts: result.artifacts,
    durationMs: result.durationMs,
  };
  if (result.error) report.error = result.error;
  return report;
}

export function renderCiStep(result, {
  name = result.gateId,
  includeGateResult = false,
} = {}) {
  const step = {
    name,
    status: CI_STATUS[result.status],
  };
  if (result.status !== 'skipped') {
    step.exitCode = gateResultToExitCode(result);
    step.durationMs = result.durationMs;
  }
  if (result.error) step.error = result.error.message;
  if (includeGateResult) step.gateResult = renderGateResultJson(result);
  return step;
}
