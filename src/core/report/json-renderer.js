const LEGACY_CI_STATUS = Object.freeze({
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

export function renderLegacyCiStep(result, {
  name = result.gateId,
  includeGateResult = false,
  exitCode = result.legacyExitCode,
} = {}) {
  const step = {
    name,
    status: LEGACY_CI_STATUS[result.status],
  };
  if (result.status !== 'skipped') {
    if (exitCode != null) step.exitCode = exitCode;
    step.durationMs = result.durationMs;
  }
  if (result.error) step.error = result.error.message;
  if (includeGateResult) step.gateResult = renderGateResultJson(result);
  return step;
}
