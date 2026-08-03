import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'repo-guard.config.json';
export const SUPPORTED_LEVELS = new Set(['notify', 'audit']);
export const DEFAULT_ESLINT_PATTERN = '*.{js,jsx,ts,tsx,vue}';
export const DEFAULT_PRETTIER_PATTERN = '*.{js,jsx,mjs,cjs,ts,tsx,vue,json,json5,jsonc,css,scss,less,html,md,mdx,yml,yaml}';

export function normalizeGitPath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function assertKnownProperties(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unsupported properties: ${unknown.join(', ')}`);
  }
}

export function globToRegExp(pattern) {
  const normalized = normalizeGitPath(pattern);
  let expression = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '*' && normalized[index + 1] === '*') {
      const followedBySlash = normalized[index + 2] === '/';
      expression += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
      continue;
    }

    if (character === '*') {
      expression += '[^/]*';
      continue;
    }

    if (character === '?') {
      expression += '[^/]';
      continue;
    }

    expression += escapeRegExp(character);
  }

  return new RegExp(`^${expression}$`);
}

export function validateConfig(value, configPath = CONFIG_FILE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }
  assertKnownProperties(
    value,
    new Set(['$schema', 'version', 'preCommit', 'rules', 'exclusions']),
    configPath,
  );
  if (value.version !== 1) {
    throw new Error(`${configPath} uses unsupported version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    throw new Error(`${configPath} must define at least one rule`);
  }
  if (value.exclusions != null && !Array.isArray(value.exclusions)) {
    throw new Error(`${configPath} exclusions must be an array`);
  }

  const preCommitValue = value.preCommit ?? {};
  if (!preCommitValue || typeof preCommitValue !== 'object' || Array.isArray(preCommitValue)) {
    throw new Error(`${configPath} preCommit must be an object`);
  }
  assertKnownProperties(
    preCommitValue,
    new Set(['eslint', 'prettier']),
    `${configPath} preCommit`,
  );

  const prettierValue = preCommitValue.prettier ?? {};
  if (!prettierValue || typeof prettierValue !== 'object' || Array.isArray(prettierValue)) {
    throw new Error(`${configPath} preCommit.prettier must be an object`);
  }
  assertKnownProperties(
    prettierValue,
    new Set(['enabled', 'pattern', 'fix', 'requireConfig']),
    `${configPath} preCommit.prettier`,
  );
  if (prettierValue.enabled != null && typeof prettierValue.enabled !== 'boolean') {
    throw new Error(`${configPath} preCommit.prettier.enabled must be a boolean`);
  }
  if (
    prettierValue.pattern != null
    && (typeof prettierValue.pattern !== 'string' || !prettierValue.pattern.trim())
  ) {
    throw new Error(`${configPath} preCommit.prettier.pattern must be a non-empty string`);
  }
  if (prettierValue.fix != null && typeof prettierValue.fix !== 'boolean') {
    throw new Error(`${configPath} preCommit.prettier.fix must be a boolean`);
  }
  if (
    prettierValue.requireConfig != null
    && typeof prettierValue.requireConfig !== 'boolean'
  ) {
    throw new Error(`${configPath} preCommit.prettier.requireConfig must be a boolean`);
  }

  const eslintValue = preCommitValue.eslint ?? {};
  if (!eslintValue || typeof eslintValue !== 'object' || Array.isArray(eslintValue)) {
    throw new Error(`${configPath} preCommit.eslint must be an object`);
  }
  assertKnownProperties(
    eslintValue,
    new Set(['enabled', 'pattern', 'fix', 'maxWarnings']),
    `${configPath} preCommit.eslint`,
  );
  if (eslintValue.enabled != null && typeof eslintValue.enabled !== 'boolean') {
    throw new Error(`${configPath} preCommit.eslint.enabled must be a boolean`);
  }
  if (
    eslintValue.pattern != null
    && (typeof eslintValue.pattern !== 'string' || !eslintValue.pattern.trim())
  ) {
    throw new Error(`${configPath} preCommit.eslint.pattern must be a non-empty string`);
  }
  if (eslintValue.fix != null && typeof eslintValue.fix !== 'boolean') {
    throw new Error(`${configPath} preCommit.eslint.fix must be a boolean`);
  }
  if (
    eslintValue.maxWarnings != null
    && (!Number.isInteger(eslintValue.maxWarnings) || eslintValue.maxWarnings < 0)
  ) {
    throw new Error(`${configPath} preCommit.eslint.maxWarnings must be a non-negative integer`);
  }

  const rules = value.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`${configPath} rule ${index + 1} must be an object`);
    }
    assertKnownProperties(
      rule,
      new Set(['pattern', 'category', 'level']),
      `${configPath} rule ${index + 1}`,
    );
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      throw new Error(`${configPath} rule ${index + 1} has no pattern`);
    }
    if (typeof rule.category !== 'string' || !rule.category.trim()) {
      throw new Error(`${configPath} rule ${index + 1} has no category`);
    }
    if (!SUPPORTED_LEVELS.has(rule.level)) {
      throw new Error(
        `${configPath} rule ${index + 1} has unsupported level: ${String(rule.level)}`,
      );
    }

    const pattern = normalizeGitPath(rule.pattern.trim());
    return {
      pattern,
      category: rule.category.trim(),
      level: rule.level,
      matcher: globToRegExp(pattern),
    };
  });

  const exclusions = (value.exclusions || []).map((pattern, index) => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error(`${configPath} exclusion ${index + 1} must be a non-empty string`);
    }
    const normalized = normalizeGitPath(pattern.trim());
    return {
      pattern: normalized,
      matcher: globToRegExp(normalized),
    };
  });

  return {
    version: 1,
    preCommit: {
      prettier: {
        enabled: prettierValue.enabled ?? false,
        pattern: prettierValue.pattern?.trim() || DEFAULT_PRETTIER_PATTERN,
        fix: prettierValue.fix ?? true,
        requireConfig: prettierValue.requireConfig ?? true,
      },
      eslint: {
        enabled: eslintValue.enabled ?? false,
        pattern: eslintValue.pattern?.trim() || DEFAULT_ESLINT_PATTERN,
        fix: eslintValue.fix ?? true,
        maxWarnings: eslintValue.maxWarnings ?? 0,
      },
    },
    rules,
    exclusions,
  };
}

export function loadConfig(root) {
  const configPath = path.join(root, CONFIG_FILE);
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${CONFIG_FILE}: ${error.message}`);
  }

  return validateConfig(parsed, CONFIG_FILE);
}

export function matchRule(filePath, config) {
  const normalized = normalizeGitPath(filePath);
  if (config.exclusions.some(({ matcher }) => matcher.test(normalized))) {
    return null;
  }

  const rule = config.rules.find(({ matcher }) => matcher.test(normalized));
  if (!rule) {
    return null;
  }

  return {
    pattern: rule.pattern,
    category: rule.category,
    level: rule.level,
  };
}
