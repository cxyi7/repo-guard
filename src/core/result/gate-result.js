import { createHash } from 'node:crypto';
import path from 'node:path';
import { errorStatus, isRepoGuardError, toRepoGuardError } from '../error/repo-guard-error.js';
import { sanitizeProcessOutput } from '../execution/output-safety.js';

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
const ISSUE_KIND_VALUES = [
  'violation',
  'configuration',
  'execution',
  'range',
  'security',
  'internal',
  'cancellation',
];

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

function publicText(value, label) {
  const text = requireNonEmptyString(value, label);
  return sanitizeProcessOutput(text, { root: process.cwd() }).text;
}

function repositoryPath(value) {
  const normalized = requireNonEmptyString(value, 'Issue location path').replaceAll('\\', '/');
  const cwd = process.cwd().replaceAll('\\', '/').replace(/\/$/, '');
  if (normalized === cwd) return '.';
  if (normalized.startsWith(`${cwd}/`)) return normalized.slice(cwd.length + 1);
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return `<absolute>/${path.posix.basename(normalized)}`;
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    return `<outside>/${path.posix.basename(normalized)}`;
  }
  return normalized;
}

function normalizeLocation(location) {
  if (location == null) return null;
  const normalized = {
    path: repositoryPath(location.path),
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

function normalizeEvidence(evidence, fallbackLocation = null) {
  if (evidence == null) return Object.freeze([]);
  const items = Array.isArray(evidence) ? evidence : [
    typeof evidence === 'string' ? { message: evidence } : evidence,
  ];
  return Object.freeze(items.map((item) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Issue evidence entries must be strings or objects');
    }
    const normalized = {
      type: item.type ?? 'observation',
      message: publicText(item.message, 'Issue evidence message'),
      location: normalizeLocation(item.location ?? fallbackLocation),
    };
    requireNonEmptyString(normalized.type, 'Issue evidence type');
    if (item.source != null) {
      normalized.source = publicText(item.source, 'Issue evidence source');
    }
    return Object.freeze(normalized);
  }));
}

function defaultRemediation(ruleId, kind) {
  if (kind === 'configuration') return {
    goal: '修正配置或项目准备条件，使门禁可以可靠执行。',
    steps: ['根据问题、位置和证据修正对应配置。'],
    constraints: ['不要通过关闭门禁或削弱策略绕过校验。'],
    verification: ['重新运行同一门禁并确认返回 passed。'],
  };
  if (kind === 'execution' || kind === 'internal' || kind === 'cancellation') return {
    goal: '恢复门禁执行，并保留原有质量策略。',
    steps: ['先检查 diagnostics 中对应 source/stream 的输出。', '修复工具、环境或门禁实现后重试。'],
    constraints: ['不要吞掉退出码、忽略异常或跳过门禁。'],
    verification: ['使用相同参数重新运行门禁。'],
  };
  if (kind === 'range') return {
    goal: '提供可验证且完整的 Git 变更范围。',
    steps: ['补齐所需提交历史或显式指定可信的 base/head。'],
    constraints: ['不要用不完整范围代替完整审查。'],
    verification: ['重新运行 CI 范围检查并确认范围可解析。'],
  };
  return {
    goal: `修复问题并满足 ${ruleId} 的规则要求。`,
    steps: [],
    constraints: ['不要禁用规则或缩小检查范围来绕过问题。'],
    verification: ['重新运行对应门禁并确认问题消失。'],
  };
}

function normalizeRemediation(remediation, ruleId, kind) {
  if (remediation == null) {
    const defaults = defaultRemediation(ruleId, kind);
    return Object.freeze({
      goal: defaults.goal,
      steps: Object.freeze(defaults.steps),
      constraints: Object.freeze(defaults.constraints),
      verification: Object.freeze(defaults.verification),
    });
  }
  if (typeof remediation === 'string') {
    return Object.freeze({
      goal: publicText(remediation, 'Issue remediation goal'),
      steps: Object.freeze([]),
      constraints: Object.freeze([]),
      verification: Object.freeze([]),
    });
  }
  if (typeof remediation !== 'object' || Array.isArray(remediation)) {
    throw new TypeError('Issue remediation must be a string or object');
  }
  const stringList = (value, label) => {
    if (value == null) return Object.freeze([]);
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return Object.freeze(value.map((item) => publicText(item, label)));
  };
  return Object.freeze({
    goal: publicText(remediation.goal, 'Issue remediation goal'),
    steps: stringList(remediation.steps, 'Issue remediation steps'),
    constraints: stringList(remediation.constraints, 'Issue remediation constraints'),
    verification: stringList(remediation.verification, 'Issue remediation verification'),
  });
}

function normalizeDecision(decision, kind) {
  const defaults = kind === 'configuration'
    ? { aiAction: 'update-configuration', humanApprovalRequired: false }
    : kind === 'security'
      ? { aiAction: 'review-security-impact', humanApprovalRequired: true }
      : { aiAction: 'modify-code', humanApprovalRequired: false };
  if (decision == null) return Object.freeze(defaults);
  if (typeof decision !== 'object' || Array.isArray(decision)) {
    throw new TypeError('Issue decision must be an object');
  }
  const humanApprovalRequired = decision.humanApprovalRequired
    ?? defaults.humanApprovalRequired;
  if (typeof humanApprovalRequired !== 'boolean') {
    throw new TypeError('Issue decision humanApprovalRequired must be a boolean');
  }
  return Object.freeze({
    aiAction: requireNonEmptyString(decision.aiAction ?? defaults.aiAction, 'Issue decision aiAction'),
    humanApprovalRequired,
  });
}

function issueFingerprint({ gateId, ruleId, code, location, message }) {
  const identity = [
    gateId ?? '',
    ruleId ?? '',
    code,
    message,
    location?.path ?? '',
    location?.line ?? '',
    location?.column ?? '',
  ].join('\u0000');
  return createHash('sha256').update(identity).digest('hex');
}

export function createFinding({
  id,
  kind = 'violation',
  gateId = 'unknown',
  ruleId,
  code = ruleId,
  severity,
  message,
  location = null,
  evidence = null,
  expected = null,
  remediation = null,
  decision = null,
  fingerprint,
}) {
  if (!ISSUE_KIND_VALUES.includes(kind)) {
    throw new TypeError(`Issue kind must be one of: ${ISSUE_KIND_VALUES.join(', ')}`);
  }
  requireNonEmptyString(gateId, 'Issue gateId');
  requireNonEmptyString(ruleId, 'Finding ruleId');
  requireNonEmptyString(code, 'Issue code');
  if (!FINDING_SEVERITIES.includes(severity)) {
    throw new TypeError(`Finding severity must be one of: ${FINDING_SEVERITY_VALUES.join(', ')}`);
  }
  requireNonEmptyString(message, 'Finding message');
  const normalizedLocation = normalizeLocation(location);
  const normalizedMessage = publicText(message, 'Finding message');
  const normalizedFingerprint = fingerprint ?? issueFingerprint({
    gateId,
    ruleId,
    code,
    message: normalizedMessage,
    location: normalizedLocation,
  });
  return Object.freeze({
    id: id ?? `issue-${normalizedFingerprint.slice(0, 12)}`,
    kind,
    gateId,
    ruleId,
    code,
    severity,
    message: normalizedMessage,
    location: normalizedLocation,
    evidence: normalizeEvidence(evidence, normalizedLocation),
    expected: expected == null
      ? `满足 ${ruleId} 的规则要求。`
      : publicText(expected, 'Issue expected'),
    remediation: normalizeRemediation(remediation, ruleId, kind),
    decision: normalizeDecision(decision, kind),
    fingerprint: requireNonEmptyString(normalizedFingerprint, 'Issue fingerprint'),
  });
}

export function createArtifact({ path, type, description = null }) {
  const normalizedPath = repositoryPath(path);
  requireNonEmptyString(type, 'Artifact type');
  if (description != null && typeof description !== 'string') {
    throw new TypeError('Artifact description must be a string or null');
  }
  return Object.freeze({
    path: normalizedPath,
    type,
    description: description == null ? null : publicText(description, 'Artifact description'),
  });
}

export function normalizeError(error, { gateId = 'unknown', fallbackKind = 'execution' } = {}) {
  if (error == null) return null;
  if (
    typeof error === 'object'
    && error.kind !== 'violation'
    && typeof error.id === 'string'
    && typeof error.fingerprint === 'string'
    && typeof error.ruleId === 'string'
  ) {
    const { name = 'RepoGuardError', ...issue } = error;
    return Object.freeze({ ...createFinding({ ...issue, gateId }), name });
  }
  const typed = isRepoGuardError(error)
    ? error
    : toRepoGuardError(error, { kind: fallbackKind });
  const ruleId = `system/${typed.kind}`;
  const issue = createFinding({
    kind: typed.kind,
    gateId,
    ruleId,
    code: typed.code,
    severity: 'error',
    message: typed.message,
    location: typed.details?.location ?? null,
    evidence: typed.details?.evidence ?? null,
    expected: typed.expected ?? `门禁 ${gateId} 应完成执行并返回结构化结果。`,
    remediation: typed.remediation,
    decision: typed.decision,
  });
  return Object.freeze({
    ...issue,
    name: typeof error?.name === 'string' && error.name ? error.name : typed.name,
  });
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
  const stream = diagnostic.stream ?? (diagnostic.level === 'error' || diagnostic.level === 'warn'
    ? 'stderr'
    : 'stdout');
  if (stream !== 'stdout' && stream !== 'stderr') {
    throw new TypeError('GateResult diagnostic stream must be stdout or stderr');
  }
  const safeMessage = sanitizeProcessOutput(diagnostic.message, { root: process.cwd() });
  return Object.freeze({
    source: publicText(diagnostic.source ?? 'repo-guard', 'GateResult diagnostic source'),
    stream,
    level: diagnostic.level,
    message: safeMessage.text,
    redacted: Boolean(diagnostic.redacted) || safeMessage.redacted,
    truncated: Boolean(diagnostic.truncated) || safeMessage.truncated,
  });
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
  const fallbackKind = status.endsWith('-error') ? status.slice(0, -6) : 'execution';
  const normalizedIssueError = error != null
    && typeof error === 'object'
    && error.kind !== 'violation'
    && typeof error.id === 'string'
    && typeof error.fingerprint === 'string';
  if (error != null && !isRepoGuardError(error) && !normalizedIssueError) {
    throw new TypeError('GateResult error must be a RepoGuardError created at the domain boundary');
  }
  const normalizedError = normalizeError(error, { gateId, fallbackKind });
  if (status.endsWith('-error') && normalizedError == null) {
    throw new TypeError(`GateResult status ${status} requires an error`);
  }
  if (!status.endsWith('-error') && normalizedError != null) {
    throw new TypeError(`GateResult status ${status} must not include an error`);
  }
  if (status.endsWith('-error') && errorStatus(error, fallbackKind) !== status) {
    throw new TypeError(
      `GateResult status ${status} does not match ${normalizedError.kind} error ${normalizedError.code}`,
    );
  }
  const normalizedFindings = findings.map((finding) => {
    const candidate = { ...finding, gateId };
    if (finding.gateId === 'unknown') {
      delete candidate.id;
      delete candidate.fingerprint;
    }
    return createFinding(candidate);
  });
  return Object.freeze({
    gateId,
    status,
    summary: publicText(summary, 'GateResult summary'),
    findings: Object.freeze(normalizedFindings),
    issues: Object.freeze(normalizedError
      ? [...normalizedFindings, normalizedError]
      : [...normalizedFindings]),
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
