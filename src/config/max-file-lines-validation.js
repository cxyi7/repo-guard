import { DEFAULT_MAX_FILE_LINES_CONFIG } from './defaults.js';
import { normalizeGitPath } from './path-matching.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

function normalizeMaxFileLineRule(rule, index, configPath) {
  const label = `${configPath} preCommit.maxFileLines rule ${index + 1}`;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw configValidationError(`${label} must be an object`);
  }
  assertKnownProperties(rule, new Set(['pattern', 'maxLines']), label);
  if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
    throw configValidationError(`${label}.pattern must be a non-empty string`);
  }
  if (!Number.isInteger(rule.maxLines) || rule.maxLines <= 0) {
    throw configValidationError(`${label}.maxLines must be a positive integer`);
  }
  return {
    pattern: normalizeGitPath(rule.pattern.trim()),
    maxLines: rule.maxLines,
  };
}

function normalizeMaxFileLineExclusions(exclusionsValue, configPath) {
  if (!Array.isArray(exclusionsValue)) {
    throw configValidationError(`${configPath} preCommit.maxFileLines.exclusions must be an array`);
  }
  return exclusionsValue.map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw configValidationError(
        `${configPath} preCommit.maxFileLines exclusion ${index + 1} must be a non-empty string`,
      );
    }
    return normalizeGitPath(pattern.trim());
  });
}

export function validateMaxFileLinesConfiguration(preCommitValue, configPath) {
  const maxFileLinesValue = preCommitValue.maxFileLines ?? {};
  if (
    !maxFileLinesValue
    || typeof maxFileLinesValue !== 'object'
    || Array.isArray(maxFileLinesValue)
  ) {
    throw configValidationError(`${configPath} preCommit.maxFileLines must be an object`);
  }
  assertKnownProperties(
    maxFileLinesValue,
    new Set(['enabled', 'mode', 'warnAt', 'rules', 'exclusions']),
    `${configPath} preCommit.maxFileLines`,
  );
  if (
    maxFileLinesValue.enabled != null
    && typeof maxFileLinesValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} preCommit.maxFileLines.enabled must be a boolean`);
  }
  if (
    maxFileLinesValue.mode != null
    && !['strict', 'noRegression'].includes(maxFileLinesValue.mode)
  ) {
    throw configValidationError(
      `${configPath} preCommit.maxFileLines.mode must be strict or noRegression`,
    );
  }
  if (
    maxFileLinesValue.warnAt != null
    && (
      typeof maxFileLinesValue.warnAt !== 'number'
      || !Number.isFinite(maxFileLinesValue.warnAt)
      || maxFileLinesValue.warnAt <= 0
      || maxFileLinesValue.warnAt > 1
    )
  ) {
    throw configValidationError(`${configPath} preCommit.maxFileLines.warnAt must be greater than 0 and at most 1`);
  }

  const rulesValue = maxFileLinesValue.rules ?? DEFAULT_MAX_FILE_LINES_CONFIG.rules;
  if (!Array.isArray(rulesValue) || rulesValue.length === 0) {
    throw configValidationError(`${configPath} preCommit.maxFileLines.rules must be a non-empty array`);
  }
  const rules = rulesValue.map((rule, index) => (
    normalizeMaxFileLineRule(rule, index, configPath)
  ));
  const exclusionsValue = maxFileLinesValue.exclusions
    ?? DEFAULT_MAX_FILE_LINES_CONFIG.exclusions;
  const exclusions = normalizeMaxFileLineExclusions(exclusionsValue, configPath);

  return {
    enabled: maxFileLinesValue.enabled ?? DEFAULT_MAX_FILE_LINES_CONFIG.enabled,
    mode: maxFileLinesValue.mode ?? DEFAULT_MAX_FILE_LINES_CONFIG.mode,
    warnAt: maxFileLinesValue.warnAt ?? DEFAULT_MAX_FILE_LINES_CONFIG.warnAt,
    rules,
    exclusions,
  };
}
