import { DEFAULT_CI_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  validateCiReportPath,
} from './validation-primitives.js';

export function validateCiConfiguration(value, configPath) {
  const ciValue = value.ci ?? {};
  if (!ciValue || typeof ciValue !== 'object' || Array.isArray(ciValue)) {
    throw configValidationError(`${configPath} ci must be an object`);
  }
  assertKnownProperties(
    ciValue,
    new Set(['enabled', 'profile', 'reportPath', 'protectedFiles']),
    `${configPath} ci`,
  );
  if (ciValue.enabled != null && typeof ciValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} ci.enabled must be a boolean`);
  }
  if (ciValue.profile != null && !['policy', 'full', 'release-ready'].includes(ciValue.profile)) {
    throw configValidationError(`${configPath} ci.profile must be policy, full, or release-ready`);
  }
  const ciReportPath = validateCiReportPath(
    ciValue.reportPath ?? DEFAULT_CI_CONFIG.reportPath,
    `${configPath} ci.reportPath`,
  );
  const ciProtectedFilesValue = ciValue.protectedFiles ?? {};
  if (!ciProtectedFilesValue || typeof ciProtectedFilesValue !== 'object'
    || Array.isArray(ciProtectedFilesValue)) {
    throw configValidationError(`${configPath} ci.protectedFiles must be an object`);
  }
  assertKnownProperties(
    ciProtectedFilesValue,
    new Set(['action']),
    `${configPath} ci.protectedFiles`,
  );
  const ciProtectedFilesAction = ciProtectedFilesValue.action
    ?? DEFAULT_CI_CONFIG.protectedFiles.action;
  if (!['report', 'fail'].includes(ciProtectedFilesAction)) {
    throw configValidationError(`${configPath} ci.protectedFiles.action must be report or fail`);
  }

  const externalGatesValue = value.externalGates ?? [];
  if (!Array.isArray(externalGatesValue)) {
    throw configValidationError(`${configPath} externalGates must be an array`);
  }
  const externalGateIds = new Set();
  const externalReportPaths = new Set();
  const externalGates = externalGatesValue.map((entry, index) => {
    const label = `${configPath} externalGates item ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw configValidationError(`${label} must be an object`);
    }
    assertKnownProperties(
      entry,
      new Set(['id', 'enabled', 'environments', 'script', 'timeoutMs', 'report']),
      label,
    );
    for (const field of ['id', 'enabled', 'environments', 'script', 'timeoutMs', 'report']) {
      if (!Object.hasOwn(entry, field)) throw configValidationError(`${label}.${field} is required`);
    }
    if (typeof entry.id !== 'string' || !/^project\.[a-z][a-z0-9-]*$/.test(entry.id)) {
      throw configValidationError(`${label}.id must use the project.<kebab-case> namespace`);
    }
    if (externalGateIds.has(entry.id)) {
      throw configValidationError(`${configPath} external gate id is duplicated: ${entry.id}`);
    }
    externalGateIds.add(entry.id);
    if (typeof entry.enabled !== 'boolean') throw configValidationError(`${label}.enabled must be a boolean`);
    if (!Array.isArray(entry.environments) || entry.environments.length === 0
      || entry.environments.some((environment) => !['manual', 'ci-full', 'release-ready'].includes(environment))
      || new Set(entry.environments).size !== entry.environments.length) {
      throw configValidationError(`${label}.environments must contain unique manual, ci-full, or release-ready values`);
    }
    if (typeof entry.script !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(entry.script)) {
      throw configValidationError(`${label}.script must be an exact npm script name`);
    }
    if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1000 || entry.timeoutMs > 1800000) {
      throw configValidationError(`${label}.timeoutMs must be between 1000 and 1800000`);
    }
    if (!entry.report || typeof entry.report !== 'object' || Array.isArray(entry.report)) {
      throw configValidationError(`${label}.report must be an object`);
    }
    assertKnownProperties(entry.report, new Set(['format', 'path']), `${label}.report`);
    if (entry.report.format !== 'repo-guard-json-v1') {
      throw configValidationError(`${label}.report.format must be repo-guard-json-v1`);
    }
    const reportSegments = typeof entry.report.path === 'string'
      ? entry.report.path.split('/')
      : [];
    if (reportSegments[0] !== 'reports'
      || reportSegments.length < 2
      || reportSegments.some((segment) => (
        !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(segment)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      ))) {
      throw configValidationError(`${label}.report.path must use a normalized path inside reports/`);
    }
    const reportPath = validateCiReportPath(entry.report.path, `${label}.report.path`);
    const reportPathKey = reportPath.toLowerCase();
    if (externalReportPaths.has(reportPathKey)) {
      throw configValidationError(`${configPath} external gate report path is duplicated: ${reportPath}`);
    }
    externalReportPaths.add(reportPathKey);
    return {
      id: entry.id,
      enabled: entry.enabled,
      environments: [...entry.environments],
      script: entry.script,
      timeoutMs: entry.timeoutMs,
      report: { format: entry.report.format, path: reportPath },
    };
  });
  if (externalReportPaths.has(ciReportPath.toLowerCase())) {
    throw configValidationError(`${configPath} external gate report path must differ from ci.reportPath`);
  }

  return {
    ci: {
      enabled: ciValue.enabled ?? DEFAULT_CI_CONFIG.enabled,
      profile: ciValue.profile ?? DEFAULT_CI_CONFIG.profile,
      reportPath: ciReportPath,
      protectedFiles: { action: ciProtectedFilesAction },
    },
    externalGates,
  };
}
