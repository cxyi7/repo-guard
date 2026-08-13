import { createGateResult } from '../core/result/gate-result.js';

export function passedResult(gateId, summary, {
  diagnostics = [],
  metrics = {},
  artifacts = [],
  durationMs = 0,
} = {}) {
  return createGateResult({
    gateId,
    status: 'passed',
    summary,
    diagnostics,
    metrics,
    artifacts,
    durationMs,
  });
}

export function skippedResult(gateId, summary) {
  return createGateResult({ gateId, status: 'skipped', summary });
}

export function violationResult(gateId, summary, {
  diagnostics = [],
  findings = [],
  metrics = {},
  artifacts = [],
  durationMs = 0,
} = {}) {
  return createGateResult({
    gateId,
    status: 'violation',
    summary,
    diagnostics,
    findings,
    metrics,
    artifacts,
    durationMs,
  });
}

export function findingFromPolicy(item, {
  severity = 'error',
  evidence = null,
  remediation = null,
} = {}) {
  return {
    ruleId: item.rule,
    severity,
    message: item.message ?? item.reason ?? `Violation of ${item.rule}`,
    location: item.path
      ? {
          path: item.path,
          ...(item.line ? { line: item.line } : {}),
          ...(item.column ? { column: item.column } : {}),
        }
      : null,
    evidence,
    remediation,
  };
}
