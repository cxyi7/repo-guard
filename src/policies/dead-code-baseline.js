import { createHash } from 'node:crypto';
import path from 'node:path';
import { configurationError } from '../core/error/repo-guard-error.js';

const SCHEMA_VERSION = 1;
const KNIP_MAJOR = 6;
const BASELINE_PROPERTIES = Object.freeze([
  'schemaVersion',
  'knipMajor',
  'issueTypes',
  'debtCount',
  'entries',
]);
const ENTRY_PROPERTIES = Object.freeze([
  'issueType',
  'path',
  'name',
  'namespace',
  'count',
  'fingerprint',
]);

function baselineFormatError(message) {
  return configurationError('dead-code/invalid-baseline', message);
}

function assertKnownProperties(value, allowed, label) {
  const unknown = Object.keys(value).filter((property) => !allowed.includes(property));
  if (unknown.length > 0) {
    throw baselineFormatError(`${label} 包含未知字段：${unknown.join(', ')}`);
  }
}

function identity({ issueType, path: issuePath, name, namespace = null }) {
  return [issueType, issuePath, name, namespace ?? ''].join('\u0000');
}

function fingerprint(entry) {
  return createHash('sha256').update(identity(entry)).digest('hex');
}

function normalizeRepositoryPath(value, label) {
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)
    || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw baselineFormatError(`${label} 必须是仓库内的相对路径`);
  }
  return normalized;
}

function normalizedEntry(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw baselineFormatError(`${label} 必须是对象`);
  }
  assertKnownProperties(value, ENTRY_PROPERTIES, label);
  for (const property of ['issueType', 'path', 'name', 'fingerprint']) {
    if (typeof value[property] !== 'string' || !value[property]) {
      throw baselineFormatError(`${label}.${property} 必须是非空字符串`);
    }
  }
  if (value.namespace != null && (typeof value.namespace !== 'string' || !value.namespace)) {
    throw baselineFormatError(`${label}.namespace 必须是非空字符串或 null`);
  }
  if (!Number.isInteger(value.count) || value.count < 1) {
    throw baselineFormatError(`${label}.count 必须是正整数`);
  }
  const entry = {
    issueType: value.issueType,
    path: normalizeRepositoryPath(value.path, `${label}.path`),
    name: value.name,
    ...(value.namespace == null ? {} : { namespace: value.namespace }),
    count: value.count,
  };
  if (value.fingerprint !== fingerprint(entry)) {
    throw baselineFormatError(`${label}.fingerprint 与问题身份不一致`);
  }
  return Object.freeze({ ...entry, fingerprint: value.fingerprint });
}

function issueEntry(issue) {
  const entry = {
    issueType: issue.type,
    path: normalizeRepositoryPath(issue.file, 'Knip 问题路径'),
    name: issue.name,
    ...(issue.namespace == null ? {} : { namespace: issue.namespace }),
  };
  return Object.freeze({ ...entry, fingerprint: fingerprint(entry) });
}

function compactEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const current = grouped.get(entry.fingerprint);
    grouped.set(entry.fingerprint, current
      ? { ...current, count: current.count + 1 }
      : { ...entry, count: 1 });
  }
  return [...grouped.values()].sort((left, right) => (
    left.fingerprint.localeCompare(right.fingerprint)
  ));
}

export function createDeadCodeBaseline(issues, issueTypes) {
  const entries = compactEntries(issues.map(issueEntry));
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    knipMajor: KNIP_MAJOR,
    issueTypes: Object.freeze([...issueTypes]),
    debtCount: entries.reduce((total, entry) => total + entry.count, 0),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  });
}

export function parseDeadCodeBaseline(value, expectedIssueTypes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== SCHEMA_VERSION || value.knipMajor !== KNIP_MAJOR
    || !Array.isArray(value.issueTypes) || !Array.isArray(value.entries)) {
    throw baselineFormatError('无效代码基线格式无效');
  }
  assertKnownProperties(value, BASELINE_PROPERTIES, '无效代码基线');
  if (JSON.stringify(value.issueTypes) !== JSON.stringify(expectedIssueTypes)) {
    throw baselineFormatError('无效代码基线的问题类型与当前 deadCode.issueTypes 不一致');
  }
  const entries = value.entries.map((entry, index) => (
    normalizedEntry(entry, `无效代码基线第 ${index + 1} 项`)
  ));
  const fingerprints = entries.map(({ fingerprint: item }) => item);
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw baselineFormatError('无效代码基线不得包含重复指纹');
  }
  const sorted = [...fingerprints].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(sorted) !== JSON.stringify(fingerprints)) {
    throw baselineFormatError('无效代码基线必须按指纹稳定排序');
  }
  const debtCount = entries.reduce((total, entry) => total + entry.count, 0);
  if (value.debtCount !== debtCount) {
    throw baselineFormatError('无效代码基线 debtCount 与条目数量不一致');
  }
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    knipMajor: KNIP_MAJOR,
    issueTypes: Object.freeze([...value.issueTypes]),
    debtCount,
    entries: Object.freeze(entries),
  });
}

function entryCounts(entries) {
  return new Map(entries.map((entry) => [entry.fingerprint, entry.count]));
}

export function compareDeadCodeDebt(issues, baseline) {
  const current = createDeadCodeBaseline(issues, baseline.issueTypes);
  const allowed = entryCounts(baseline.entries);
  const currentCounts = entryCounts(current.entries);
  const additions = [];
  const resolved = [];
  for (const entry of current.entries) {
    const extra = entry.count - (allowed.get(entry.fingerprint) ?? 0);
    if (extra > 0) additions.push(Object.freeze({ ...entry, count: extra }));
  }
  for (const entry of baseline.entries) {
    const removed = entry.count - (currentCounts.get(entry.fingerprint) ?? 0);
    if (removed > 0) resolved.push(Object.freeze({ ...entry, count: removed }));
  }
  return Object.freeze({ current, additions: Object.freeze(additions), resolved: Object.freeze(resolved) });
}

function previousFingerprint(entry, currentToPreviousPath) {
  const previousPath = currentToPreviousPath.get(entry.path) ?? entry.path;
  return fingerprint({ ...entry, path: previousPath });
}

export function compareBaselineExpansion(current, previous, renames = []) {
  const previousCounts = entryCounts(previous.entries);
  const currentToPreviousPath = new Map(
    renames.filter(({ oldPath, path: currentPath }) => oldPath && currentPath)
      .map(({ oldPath, path: currentPath }) => [currentPath, oldPath]),
  );
  const additions = [];
  for (const entry of current.entries) {
    const comparable = previousFingerprint(entry, currentToPreviousPath);
    const extra = entry.count - (previousCounts.get(comparable) ?? 0);
    if (extra > 0) additions.push(Object.freeze({ ...entry, count: extra }));
  }
  return Object.freeze(additions);
}
