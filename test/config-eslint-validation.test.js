import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ESLINT_CONFIG } from '../src/config/defaults.js';
import { validateEslintConfiguration } from '../src/config/eslint-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies ESLint defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateEslintConfiguration({}, CONFIG_PATH),
    DEFAULT_ESLINT_CONFIG,
  );
});

test('normalizes ESLint staged quality settings', () => {
  assert.deepEqual(validateEslintConfiguration({
    eslint: {
      enabled: false,
      preset: false,
      pattern: ' src/**/*.{js,vue} ',
      fix: false,
      maxWarnings: 3,
    },
  }, CONFIG_PATH), {
    enabled: false,
    preset: false,
    pattern: 'src/**/*.{js,vue}',
    fix: false,
    maxWarnings: 3,
  });
});

test('requires an ESLint object with supported properties', () => {
  assert.throws(
    () => validateEslintConfiguration({ eslint: [] }, CONFIG_PATH),
    /preCommit\.eslint 必须是对象/,
  );
  assert.throws(
    () => validateEslintConfiguration({
      eslint: { command: 'eslint --fix' },
    }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
});

test('requires valid ESLint staged quality settings', () => {
  assert.throws(
    () => validateEslintConfiguration({ eslint: { enabled: 'yes' } }, CONFIG_PATH),
    /eslint\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateEslintConfiguration({ eslint: { preset: 'yes' } }, CONFIG_PATH),
    /eslint\.preset 必须是布尔值/,
  );
  assert.throws(
    () => validateEslintConfiguration({ eslint: { pattern: '  ' } }, CONFIG_PATH),
    /eslint\.pattern 必须是非空字符串/,
  );
  assert.throws(
    () => validateEslintConfiguration({ eslint: { fix: 'yes' } }, CONFIG_PATH),
    /eslint\.fix 必须是布尔值/,
  );
  assert.throws(
    () => validateEslintConfiguration({ eslint: { maxWarnings: -1 } }, CONFIG_PATH),
    /eslint\.maxWarnings 必须是非负整数/,
  );
});
