import { DEFAULT_FILE_PLACEMENT_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

function normalizeFilePlacementRule(rule, index, configPath) {
  const label = `${configPath} preCommit.filePlacement 规则 ${index + 1}`;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    rule,
    new Set([
      'name',
      'patterns',
      'allowedPatterns',
      'exceptions',
      'suggestedDirectory',
    ]),
    label,
  );
  if (typeof rule.name !== 'string' || !rule.name.trim()) {
    throw configValidationError(`${label}.name 必须是非空字符串`);
  }
  const suggestedDirectory = normalizeRelativePattern(
    rule.suggestedDirectory,
    `${label}.suggestedDirectory`,
  ).replace(/\/$/, '');
  if (['*', '?', '{', '}', '[', ']', '!'].some((character) => (
    suggestedDirectory.includes(character)
  ))) {
    throw configValidationError(`${label}.suggestedDirectory 必须是具体目录`);
  }
  return {
    name: rule.name.trim(),
    patterns: normalizePatternList(rule.patterns, `${label}.patterns`),
    allowedPatterns: normalizePatternList(
      rule.allowedPatterns,
      `${label}.allowedPatterns`,
    ),
    exceptions: normalizePatternList(
      rule.exceptions ?? [],
      `${label}.exceptions`,
      { allowEmpty: true },
    ),
    suggestedDirectory,
  };
}

export function validateFilePlacementConfiguration(preCommitValue, configPath) {
  const filePlacementValue = preCommitValue.filePlacement ?? {};
  if (
    !filePlacementValue
    || typeof filePlacementValue !== 'object'
    || Array.isArray(filePlacementValue)
  ) {
    throw configValidationError(`${configPath} preCommit.filePlacement 必须是对象`);
  }
  assertKnownProperties(
    filePlacementValue,
    new Set(['enabled', 'mode', 'rules']),
    `${configPath} preCommit.filePlacement`,
  );
  if (
    filePlacementValue.enabled != null
    && typeof filePlacementValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} preCommit.filePlacement.enabled 必须是布尔值`);
  }
  if (
    filePlacementValue.mode != null
    && !['newFiles', 'changedFiles'].includes(filePlacementValue.mode)
  ) {
    throw configValidationError(
      `${configPath} preCommit.filePlacement.mode 必须为 newFiles 或 changedFiles`,
    );
  }
  const rulesValue = filePlacementValue.rules ?? DEFAULT_FILE_PLACEMENT_CONFIG.rules;
  if (!Array.isArray(rulesValue) || rulesValue.length === 0) {
    throw configValidationError(`${configPath} preCommit.filePlacement.rules 必须是非空数组`);
  }
  return {
    enabled: filePlacementValue.enabled ?? DEFAULT_FILE_PLACEMENT_CONFIG.enabled,
    mode: filePlacementValue.mode ?? DEFAULT_FILE_PLACEMENT_CONFIG.mode,
    rules: rulesValue.map((rule, index) => (
      normalizeFilePlacementRule(rule, index, configPath)
    )),
  };
}
