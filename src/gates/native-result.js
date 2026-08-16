import { createGateResult } from '../core/result/gate-result.js';

export function passedResult(gateId, summary, {
  diagnostics = [],
  findings = [],
  metrics = {},
  artifacts = [],
  durationMs = 0,
} = {}) {
  return createGateResult({
    gateId,
    status: 'passed',
    summary,
    diagnostics,
    findings,
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
  expected = null,
} = {}) {
  return {
    ruleId: item.rule,
    code: item.issue ?? item.rule,
    severity,
    message: item.message ?? `违反规则 ${item.rule}`,
    location: item.path
      ? {
          path: item.path,
          ...(item.line ? { line: item.line } : {}),
          ...(item.column ? { column: item.column } : {}),
        }
      : null,
    evidence: evidence ?? item.evidence ?? null,
    expected: expected ?? item.expected ?? null,
    remediation: remediation ?? item.remediation ?? null,
    decision: item.decision ?? null,
  };
}
