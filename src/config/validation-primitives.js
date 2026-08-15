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
    throw configValidationError(`${label} has unsupported properties: ${unknown.join(', ')}`);
  }
}

export function normalizeIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw configValidationError(`${label} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw configValidationError(`${label} must be a valid calendar date`);
  }
  return value;
}

export function normalizeRelativePattern(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw configValidationError(`${label} must be a non-empty string`);
  }
  const pattern = normalizeGitPath(value.trim());
  if (
    path.isAbsolute(value.trim())
    || pattern.startsWith('/')
    || /^[A-Za-z]:\//.test(pattern)
    || pattern.startsWith('!')
    || pattern.split('/').includes('..')
  ) {
    throw configValidationError(`${label} must stay inside the repository`);
  }
  return pattern;
}

export function validateCiReportPath(value, label = 'CI report path') {
  const reportPath = normalizeRelativePattern(value, label);
  if (!/^reports\/.+\.json$/.test(reportPath)) {
    throw configValidationError(`${label} must be a JSON file inside reports/`);
  }
  return reportPath;
}

export function normalizePatternList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw configValidationError(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`);
  }
  return value.map((pattern, index) => (
    normalizeRelativePattern(pattern, `${label} item ${index + 1}`)
  ));
}
