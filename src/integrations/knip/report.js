import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';

const POSITION_FIELDS = Object.freeze(['line', 'col', 'pos']);

function normalizeReportPath(value) {
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)
    || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw executionError(
      'dead-code/invalid-knip-report',
      `Knip JSON 包含仓库外路径：${value}`,
    );
  }
  return normalized;
}

function normalizeItem(item, type, file) {
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || typeof item.name !== 'string' || item.name.trim() === '') {
    throw executionError(
      'dead-code/invalid-knip-report',
      `Knip JSON 中 ${type} 问题的结构无效`,
    );
  }
  const normalized = { type, file, name: item.name };
  for (const field of POSITION_FIELDS) {
    if (item[field] == null) continue;
    if (!Number.isInteger(item[field]) || item[field] < (field === 'pos' ? 0 : 1)) {
      throw executionError('dead-code/invalid-knip-report', `Knip JSON 的 ${field} 位置无效`);
    }
    normalized[field] = item[field];
  }
  if (typeof item.namespace === 'string' && item.namespace) {
    normalized.namespace = item.namespace;
  }
  return Object.freeze(normalized);
}

export function parseKnipJsonReport(output, enabledTypes) {
  let parsed;
  try {
    parsed = JSON.parse(String(output).trim());
  } catch (error) {
    throw executionError(
      'dead-code/invalid-knip-json',
      `Knip 返回了无效 JSON：${error.message}`,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.issues)) {
    throw executionError('dead-code/invalid-knip-report', 'Knip JSON 缺少 issues 数组');
  }
  const issues = [];
  for (const group of parsed.issues) {
    if (!group || typeof group !== 'object' || Array.isArray(group)
      || typeof group.file !== 'string' || group.file.trim() === '') {
      throw executionError('dead-code/invalid-knip-report', 'Knip JSON 包含无效的文件问题组');
    }
    const file = normalizeReportPath(group.file);
    const reportTypes = enabledTypes.flatMap((type) => (
      type === 'dependencies'
        ? ['dependencies', 'devDependencies', 'optionalPeerDependencies']
        : [type]
    ));
    for (const reportType of reportTypes) {
      const items = group[reportType];
      if (items == null) continue;
      if (!Array.isArray(items)) {
        throw executionError('dead-code/invalid-knip-report', `Knip JSON 中 ${reportType} 必须是数组`);
      }
      const issueType = ['devDependencies', 'optionalPeerDependencies'].includes(reportType)
        ? 'dependencies'
        : reportType;
      issues.push(...items.map((item) => normalizeItem(item, issueType, file)));
    }
  }
  return Object.freeze(issues);
}
