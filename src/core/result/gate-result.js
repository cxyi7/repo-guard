const GATE_STATUS_VALUES = [
  'passed',
  'skipped',
  'violation',
  'configuration-error',
  'execution-error',
  'range-error',
];

const FINDING_SEVERITY_VALUES = ['info', 'warning', 'error'];
const DIAGNOSTIC_LEVEL_VALUES = ['log', 'info', 'warn', 'error'];

export const GATE_STATUSES = Object.freeze([...GATE_STATUS_VALUES]);
export const FINDING_SEVERITIES = Object.freeze([...FINDING_SEVERITY_VALUES]);

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function normalizeLocation(location) {
  if (location == null) return null;
  const normalized = {
    path: requireNonEmptyString(location.path, 'Finding location path'),
  };
  for (const key of ['line', 'column', 'endLine', 'endColumn']) {
    if (location[key] == null) continue;
    if (!Number.isInteger(location[key]) || location[key] < 1) {
      throw new TypeError(`Finding location ${key} must be a positive integer`);
    }
    normalized[key] = location[key];
  }
  return Object.freeze(normalized);
}

export function createFinding({
  ruleId,
  severity,
  message,
  location = null,
  evidence = null,
  remediation = null,
}) {
  requireNonEmptyString(ruleId, 'Finding ruleId');
  if (!FINDING_SEVERITIES.includes(severity)) {
    throw new TypeError(`Finding severity must be one of: ${FINDING_SEVERITY_VALUES.join(', ')}`);
  }
  requireNonEmptyString(message, 'Finding message');
  if (evidence != null && typeof evidence !== 'string') {
    throw new TypeError('Finding evidence must be a string or null');
  }
  if (remediation != null && typeof remediation !== 'string') {
    throw new TypeError('Finding remediation must be a string or null');
  }
  return Object.freeze({
    ruleId,
    severity,
    message,
    location: normalizeLocation(location),
    evidence,
    remediation,
  });
}

export function createArtifact({ path, type, description = null }) {
  requireNonEmptyString(path, 'Artifact path');
  requireNonEmptyString(type, 'Artifact type');
  if (description != null && typeof description !== 'string') {
    throw new TypeError('Artifact description must be a string or null');
  }
  return Object.freeze({ path, type, description });
}

export function normalizeError(error) {
  if (error == null) return null;
  if (typeof error === 'string') return Object.freeze({ name: 'Error', message: error });
  const normalized = {
    name: typeof error.name === 'string' && error.name ? error.name : 'Error',
    message: typeof error.message === 'string' && error.message
      ? error.message
      : String(error),
  };
  if (typeof error.code === 'string' && error.code) normalized.code = error.code;
  return Object.freeze(normalized);
}

function normalizeMetrics(metrics) {
  if (metrics == null || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new TypeError('GateResult metrics must be an object');
  }
  const normalized = {};
  for (const [name, value] of Object.entries(metrics)) {
    requireNonEmptyString(name, 'GateResult metric name');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`GateResult metric ${name} must be a finite number`);
    }
    normalized[name] = value;
  }
  return Object.freeze(normalized);
}

function normalizeDiagnostic(diagnostic) {
  if (diagnostic == null || typeof diagnostic !== 'object') {
    throw new TypeError('GateResult diagnostic must be an object');
  }
  if (!DIAGNOSTIC_LEVEL_VALUES.includes(diagnostic.level)) {
    throw new TypeError(
      `GateResult diagnostic level must be one of: ${DIAGNOSTIC_LEVEL_VALUES.join(', ')}`,
    );
  }
  if (typeof diagnostic.message !== 'string') {
    throw new TypeError('GateResult diagnostic message must be a string');
  }
  return Object.freeze({ level: diagnostic.level, message: diagnostic.message });
}

export function createGateResult({
  gateId,
  status,
  summary,
  findings = [],
  artifacts = [],
  metrics = {},
  durationMs = 0,
  error = null,
  diagnostics = [],
}) {
  requireNonEmptyString(gateId, 'GateResult gateId');
  if (!GATE_STATUSES.includes(status)) {
    throw new TypeError(`GateResult status must be one of: ${GATE_STATUS_VALUES.join(', ')}`);
  }
  requireNonEmptyString(summary, 'GateResult summary');
  if (!Array.isArray(findings) || !Array.isArray(artifacts) || !Array.isArray(diagnostics)) {
    throw new TypeError('GateResult findings, artifacts, and diagnostics must be arrays');
  }
  const normalizedError = normalizeError(error);
  if (status.endsWith('-error') && normalizedError == null) {
    throw new TypeError(`GateResult status ${status} requires an error`);
  }
  if (!status.endsWith('-error') && normalizedError != null) {
    throw new TypeError(`GateResult status ${status} must not include an error`);
  }
  return Object.freeze({
    gateId,
    status,
    summary,
    findings: Object.freeze(findings.map((finding) => createFinding(finding))),
    artifacts: Object.freeze(artifacts.map((artifact) => createArtifact(artifact))),
    metrics: normalizeMetrics(metrics),
    durationMs: requireNonNegativeNumber(durationMs, 'GateResult durationMs'),
    error: normalizedError,
    diagnostics: Object.freeze(diagnostics.map(normalizeDiagnostic)),
  });
}

export function gateStatusToExitCode(status) {
  if (!GATE_STATUSES.includes(status)) {
    throw new TypeError(`Unknown GateStatus: ${status}`);
  }
  if (status === 'passed' || status === 'skipped') return 0;
  if (status === 'violation') return 2;
  if (status === 'range-error') return 3;
  return 1;
}

export function gateResultToExitCode(result) {
  return gateStatusToExitCode(result.status);
}
