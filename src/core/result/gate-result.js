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
    throw new TypeError(`${label} 必须是非空字符串`);
  }
  return value;
}

function requireNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} 必须是非负有限数值`);
  }
  return value;
}

function publicText(value, label) {
  const text = requireNonEmptyString(value, label);
  return sanitizeProcessOutput(text, { root: process.cwd() }).text;
}

function repositoryPath(value) {
  const normalized = requireNonEmptyString(value, '问题位置路径').replaceAll('\\', '/');
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
      throw new TypeError(`Finding location ${key} 必须是正整数`);
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
      throw new TypeError('Issue evidence 中的条目必须是字符串或对象');
    }
    const normalized = {
      type: item.type ?? 'observation',
      message: publicText(item.message, '问题证据消息'),
      location: normalizeLocation(item.location ?? fallbackLocation),
    };
    requireNonEmptyString(normalized.type, '问题证据类型');
    if (item.source != null) {
      normalized.source = publicText(item.source, '问题证据来源');
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
      goal: publicText(remediation, '问题修复目标'),
      steps: Object.freeze([]),
      constraints: Object.freeze([]),
      verification: Object.freeze([]),
    });
  }
  if (typeof remediation !== 'object' || Array.isArray(remediation)) {
    throw new TypeError('Issue remediation 必须是字符串或对象');
  }
  const stringList = (value, label) => {
    if (value == null) return Object.freeze([]);
    if (!Array.isArray(value)) throw new TypeError(`${label} 必须是数组`);
    return Object.freeze(value.map((item) => publicText(item, label)));
  };
  return Object.freeze({
    goal: publicText(remediation.goal, '问题修复目标'),
    steps: stringList(remediation.steps, '问题修复步骤'),
    constraints: stringList(remediation.constraints, '问题修复约束'),
    verification: stringList(remediation.verification, '问题修复验证方式'),
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
    throw new TypeError('Issue decision 必须是对象');
  }
  const humanApprovalRequired = decision.humanApprovalRequired
    ?? defaults.humanApprovalRequired;
  if (typeof humanApprovalRequired !== 'boolean') {
    throw new TypeError('Issue decision humanApprovalRequired 必须是布尔值');
  }
  return Object.freeze({
    aiAction: requireNonEmptyString(decision.aiAction ?? defaults.aiAction, '问题决策的 aiAction'),
    humanApprovalRequired,
  });
}

function issueFingerprint({ gateId, ruleId, code, kind, severity, location }) {
  const identity = [
    gateId ?? '',
    ruleId ?? '',
    code,
    kind,
    severity,
    location?.path ?? '',
    location?.line ?? '',
    location?.column ?? '',
    location?.endLine ?? '',
    location?.endColumn ?? '',
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
    throw new TypeError(`Issue kind 必须是以下值之一： ${ISSUE_KIND_VALUES.join(', ')}`);
  }
  requireNonEmptyString(gateId, '问题所属门禁的 gateId');
  requireNonEmptyString(ruleId, '问题项的 ruleId');
  requireNonEmptyString(code, '问题代码');
  if (!FINDING_SEVERITIES.includes(severity)) {
    throw new TypeError(`Finding severity 必须是以下值之一： ${FINDING_SEVERITY_VALUES.join(', ')}`);
  }
  requireNonEmptyString(message, '问题项消息');
  const normalizedLocation = normalizeLocation(location);
  const normalizedMessage = publicText(message, '问题项消息');
  const normalizedFingerprint = fingerprint ?? issueFingerprint({
    gateId,
    ruleId,
    code,
    kind,
    severity,
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
      : publicText(expected, '问题预期结果'),
    remediation: normalizeRemediation(remediation, ruleId, kind),
    decision: normalizeDecision(decision, kind),
    fingerprint: requireNonEmptyString(normalizedFingerprint, '问题指纹'),
  });
}

export function createArtifact({ path, type, description = null }) {
  const normalizedPath = repositoryPath(path);
  requireNonEmptyString(type, '产物类型');
  if (description != null && typeof description !== 'string') {
    throw new TypeError('Artifact description 必须是字符串或 null');
  }
  return Object.freeze({
    path: normalizedPath,
    type,
    description: description == null ? null : publicText(description, '产物说明'),
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
    throw new TypeError('GateResult metrics 必须是对象');
  }
  const normalized = {};
  for (const [name, value] of Object.entries(metrics)) {
    requireNonEmptyString(name, '门禁结果指标名称');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`GateResult 指标 ${name} 必须是有限数值`);
    }
    normalized[name] = value;
  }
  return Object.freeze(normalized);
}

function normalizeDiagnostic(diagnostic) {
  if (diagnostic == null || typeof diagnostic !== 'object') {
    throw new TypeError('GateResult diagnostic 必须是对象');
  }
  if (!DIAGNOSTIC_LEVEL_VALUES.includes(diagnostic.level)) {
    throw new TypeError(
      `GateResult diagnostic level 必须是以下值之一： ${DIAGNOSTIC_LEVEL_VALUES.join(', ')}`,
    );
  }
  if (typeof diagnostic.message !== 'string') {
    throw new TypeError('GateResult diagnostic message 必须是字符串');
  }
  const stream = diagnostic.stream ?? (diagnostic.level === 'error' || diagnostic.level === 'warn'
    ? 'stderr'
    : 'stdout');
  if (stream !== 'stdout' && stream !== 'stderr') {
    throw new TypeError('GateResult diagnostic stream 必须为 stdout 或 stderr');
  }
  const safeMessage = sanitizeProcessOutput(diagnostic.message, { root: process.cwd() });
  return Object.freeze({
    source: publicText(diagnostic.source ?? 'repo-guard', '门禁结果诊断来源'),
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
  requireNonEmptyString(gateId, '门禁结果的 gateId');
  if (!GATE_STATUSES.includes(status)) {
    throw new TypeError(`GateResult status 必须是以下值之一： ${GATE_STATUS_VALUES.join(', ')}`);
  }
  requireNonEmptyString(summary, '门禁结果摘要');
  if (!Array.isArray(findings) || !Array.isArray(artifacts) || !Array.isArray(diagnostics)) {
    throw new TypeError('GateResult findings、artifacts 和 diagnostics 必须是数组');
  }
  const fallbackKind = status.endsWith('-error') ? status.slice(0, -6) : 'execution';
  const normalizedIssueError = error != null
    && typeof error === 'object'
    && error.kind !== 'violation'
    && typeof error.id === 'string'
    && typeof error.fingerprint === 'string';
  if (error != null && !isRepoGuardError(error) && !normalizedIssueError) {
    throw new TypeError('GateResult error 必须是在领域边界创建的 RepoGuardError');
  }
  const normalizedError = normalizeError(error, { gateId, fallbackKind });
  if (status.endsWith('-error') && normalizedError == null) {
    throw new TypeError(`GateResult status 为 ${status} 时必须包含 error`);
  }
  if (!status.endsWith('-error') && normalizedError != null) {
    throw new TypeError(`GateResult status 为 ${status} 时不得包含 error`);
  }
  if (status.endsWith('-error') && errorStatus(error, fallbackKind) !== status) {
    throw new TypeError(
      `GateResult status ${status} 与 ${normalizedError.kind} 错误 ${normalizedError.code} 不匹配`,
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
    summary: publicText(summary, '门禁结果摘要'),
    findings: Object.freeze(normalizedFindings),
    issues: Object.freeze(normalizedError
      ? [...normalizedFindings, normalizedError]
      : [...normalizedFindings]),
    artifacts: Object.freeze(artifacts.map((artifact) => createArtifact(artifact))),
    metrics: normalizeMetrics(metrics),
    durationMs: requireNonNegativeNumber(durationMs, '门禁结果的 durationMs'),
    error: normalizedError,
    diagnostics: Object.freeze(diagnostics.map(normalizeDiagnostic)),
  });
}

export function gateStatusToExitCode(status) {
  if (!GATE_STATUSES.includes(status)) {
    throw new TypeError(`未知的 GateStatus： ${status}`);
  }
  if (status === 'passed' || status === 'skipped') return 0;
  if (status === 'violation') return 2;
  if (status === 'range-error') return 3;
  return 1;
}

export function gateResultToExitCode(result) {
  return gateStatusToExitCode(result.status);
}
