import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MAX_FILE_LINES_CONFIG } from '../src/config/defaults.js';
import { validateMaxFileLinesConfiguration } from '../src/config/max-file-lines-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies maximum file line defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateMaxFileLinesConfiguration({}, CONFIG_PATH),
    DEFAULT_MAX_FILE_LINES_CONFIG,
  );
});

test('normalizes maximum file line modes, rules, and exclusions', () => {
  assert.deepEqual(validateMaxFileLinesConfiguration({
    maxFileLines: {
      enabled: true,
      mode: 'noRegression',
      warnAt: 0.9,
      rules: [
        { pattern: ' src/**/*.vue ', maxLines: 700 },
        { pattern: ' **/*.js ', maxLines: 1000 },
      ],
      exclusions: [' src/generated/** '],
    },
  }, CONFIG_PATH), {
    enabled: true,
    mode: 'noRegression',
    warnAt: 0.9,
    rules: [
      { pattern: 'src/**/*.vue', maxLines: 700 },
      { pattern: '**/*.js', maxLines: 1000 },
    ],
    exclusions: ['src/generated/**'],
  });
});

test('requires a maximum file lines object with valid settings', () => {
  assert.throws(
    () => validateMaxFileLinesConfiguration({ maxFileLines: [] }, CONFIG_PATH),
    /preCommit\.maxFileLines 必须是对象/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { command: 'check' },
    }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { enabled: 'yes' },
    }, CONFIG_PATH),
    /maxFileLines\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { mode: 'gradual' },
    }, CONFIG_PATH),
    /mode 必须为 strict 或 noRegression/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { warnAt: 0 },
    }, CONFIG_PATH),
    /warnAt 必须大于 0 且不超过 1/,
  );
});

test('requires structured maximum file line rules', () => {
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: [] },
    }, CONFIG_PATH),
    /rules 必须是非空数组/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: ['invalid'] },
    }, CONFIG_PATH),
    /规则 1 必须是对象/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: [{ pattern: '  ', maxLines: 100 }] },
    }, CONFIG_PATH),
    /规则 1\.pattern 必须是非空字符串/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: [{ pattern: '**/*.vue', maxLines: 0 }] },
    }, CONFIG_PATH),
    /规则 1\.maxLines 必须是正整数/,
  );
});

test('requires valid maximum file line exclusions', () => {
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { exclusions: 'src/generated/**' },
    }, CONFIG_PATH),
    /exclusions 必须是数组/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { exclusions: [''] },
    }, CONFIG_PATH),
    /排除项 1 必须是非空字符串/,
  );
});
