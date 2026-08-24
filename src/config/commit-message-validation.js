import { DEFAULT_COMMIT_MESSAGE_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

const IDENTIFIER = /^[a-z][a-z0-9-]*$/;
const SCOPE = /^[a-z0-9][a-z0-9._/@-]*$/;

function booleanValue(value, fallback, label) {
  if (value != null && typeof value !== 'boolean') {
    throw configValidationError(`${label} 必须是布尔值`);
  }
  return value ?? fallback;
}

function objectValue(value, fallback, properties, label) {
  const candidate = value ?? {};
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(candidate, new Set(properties), label);
  return { ...fallback, ...candidate };
}

function stringList(value, fallback, label, pattern, { allowEmpty = false } = {}) {
  const candidate = value ?? fallback;
  if (!Array.isArray(candidate) || (!allowEmpty && candidate.length === 0)
    || candidate.some((entry) => typeof entry !== 'string' || !pattern.test(entry))) {
    throw configValidationError(`${label} 必须是${allowEmpty ? '' : '非空'}规范标识符数组`);
  }
  if (new Set(candidate).size !== candidate.length) {
    throw configValidationError(`${label} 不得包含重复值`);
  }
  return [...candidate];
}

export function validateCommitMessageConfiguration(value, configPath) {
  const candidate = value.commitMessage ?? {};
  const label = `${configPath} commitMessage`;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(candidate, new Set([
    'enabled',
    'types',
    'requireScope',
    'allowedScopes',
    'headerMaxLength',
    'breakingChange',
    'merge',
    'revert',
    'fixup',
  ]), label);
  if (candidate.headerMaxLength != null
    && (!Number.isInteger(candidate.headerMaxLength) || candidate.headerMaxLength < 10)) {
    throw configValidationError(`${label}.headerMaxLength 必须是大于或等于 10 的整数`);
  }
  const breakingChange = objectValue(
    candidate.breakingChange,
    DEFAULT_COMMIT_MESSAGE_CONFIG.breakingChange,
    ['allowed', 'requireMarker', 'requireFooter', 'requireMajorVersionOnRelease'],
    `${label}.breakingChange`,
  );
  const merge = objectValue(
    candidate.merge,
    DEFAULT_COMMIT_MESSAGE_CONFIG.merge,
    ['allowed'],
    `${label}.merge`,
  );
  const revert = objectValue(
    candidate.revert,
    DEFAULT_COMMIT_MESSAGE_CONFIG.revert,
    ['allowed'],
    `${label}.revert`,
  );
  const fixup = objectValue(
    candidate.fixup,
    DEFAULT_COMMIT_MESSAGE_CONFIG.fixup,
    ['allowLocal', 'allowPush', 'allowCi'],
    `${label}.fixup`,
  );
  return {
    enabled: booleanValue(candidate.enabled, DEFAULT_COMMIT_MESSAGE_CONFIG.enabled, `${label}.enabled`),
    types: stringList(candidate.types, DEFAULT_COMMIT_MESSAGE_CONFIG.types, `${label}.types`, IDENTIFIER),
    requireScope: booleanValue(candidate.requireScope, DEFAULT_COMMIT_MESSAGE_CONFIG.requireScope, `${label}.requireScope`),
    allowedScopes: stringList(
      candidate.allowedScopes,
      DEFAULT_COMMIT_MESSAGE_CONFIG.allowedScopes,
      `${label}.allowedScopes`,
      SCOPE,
      { allowEmpty: true },
    ),
    headerMaxLength: candidate.headerMaxLength ?? DEFAULT_COMMIT_MESSAGE_CONFIG.headerMaxLength,
    breakingChange: {
      allowed: booleanValue(breakingChange.allowed, true, `${label}.breakingChange.allowed`),
      requireMarker: booleanValue(breakingChange.requireMarker, true, `${label}.breakingChange.requireMarker`),
      requireFooter: booleanValue(breakingChange.requireFooter, true, `${label}.breakingChange.requireFooter`),
      requireMajorVersionOnRelease: booleanValue(
        breakingChange.requireMajorVersionOnRelease,
        true,
        `${label}.breakingChange.requireMajorVersionOnRelease`,
      ),
    },
    merge: {
      allowed: booleanValue(merge.allowed, true, `${label}.merge.allowed`),
    },
    revert: {
      allowed: booleanValue(revert.allowed, true, `${label}.revert.allowed`),
    },
    fixup: {
      allowLocal: booleanValue(fixup.allowLocal, true, `${label}.fixup.allowLocal`),
      allowPush: booleanValue(fixup.allowPush, false, `${label}.fixup.allowPush`),
      allowCi: booleanValue(fixup.allowCi, false, `${label}.fixup.allowCi`),
    },
  };
}
