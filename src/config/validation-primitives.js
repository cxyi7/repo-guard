import path from 'node:path';
import { configurationError } from '../core/error/repo-guard-error.js';
import { normalizeGitPath } from './path-matching.js';

export const CONFIG_FILE = 'repo-guard.config.json';

export function configValidationError(message) {
  return configurationError('config/invalid-value', message, {
    details: {
      location: { path: CONFIG_FILE },
      evidence: [{
        type: 'configuration-validation',
        message,
        location: { path: CONFIG_FILE },
      }],
    },
    expected: `${CONFIG_FILE} 中对应字段满足当前配置 Schema。`,
    remediation: {
      goal: '修正报告中指出的配置字段，同时保留已启用门禁的约束强度',
      steps: ['根据字段路径、当前值要求和 config.schema.json 修正配置'],
      constraints: ['不得仅通过关闭门禁来绕过配置校验'],
      verification: ['运行 npm run guard:check 并确认配置门禁通过'],
    },
  });
}

export function assertKnownProperties(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw configValidationError(`${label} 包含不支持的属性： ${unknown.join(', ')}`);
  }
}

export function normalizeIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw configValidationError(`${label} 必须使用 YYYY-MM-DD 格式`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw configValidationError(`${label} 必须是有效的日历日期`);
  }
  return value;
}

export function normalizeRelativePattern(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw configValidationError(`${label} 必须是非空字符串`);
  }
  const pattern = normalizeGitPath(value.trim());
  if (
    path.isAbsolute(value.trim())
    || pattern.startsWith('/')
    || /^[A-Za-z]:\//.test(pattern)
    || pattern.startsWith('!')
    || pattern.split('/').includes('..')
  ) {
    throw configValidationError(`${label} 必须位于仓库内部`);
  }
  return pattern;
}

export function validateCiReportPath(value, label = 'CI 报告路径') {
  const reportPath = normalizeRelativePattern(value, label);
  if (!/^reports\/.+\.json$/.test(reportPath)) {
    throw configValidationError(`${label} 必须是 reports/ 内的 JSON 文件`);
  }
  return reportPath;
}

export function normalizePatternList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw configValidationError(`${label} ${allowEmpty ? '必须是数组' : '必须是非空数组'}`);
  }
  return value.map((pattern, index) => (
    normalizeRelativePattern(pattern, `${label} 第 ${index + 1}`)
  ));
}
