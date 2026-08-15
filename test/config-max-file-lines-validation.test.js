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
    /preCommit\.maxFileLines must be an object/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { command: 'check' },
    }, CONFIG_PATH),
    /has unsupported properties: command/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { enabled: 'yes' },
    }, CONFIG_PATH),
    /maxFileLines\.enabled must be a boolean/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { mode: 'gradual' },
    }, CONFIG_PATH),
    /mode must be strict or noRegression/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { warnAt: 0 },
    }, CONFIG_PATH),
    /warnAt must be greater than 0 and at most 1/,
  );
});

test('requires structured maximum file line rules', () => {
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: [] },
    }, CONFIG_PATH),
    /rules must be a non-empty array/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: ['invalid'] },
    }, CONFIG_PATH),
    /rule 1 must be an object/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: [{ pattern: '  ', maxLines: 100 }] },
    }, CONFIG_PATH),
    /rule 1\.pattern must be a non-empty string/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { rules: [{ pattern: '**/*.vue', maxLines: 0 }] },
    }, CONFIG_PATH),
    /rule 1\.maxLines must be a positive integer/,
  );
});

test('requires valid maximum file line exclusions', () => {
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { exclusions: 'src/generated/**' },
    }, CONFIG_PATH),
    /exclusions must be an array/,
  );
  assert.throws(
    () => validateMaxFileLinesConfiguration({
      maxFileLines: { exclusions: [''] },
    }, CONFIG_PATH),
    /exclusion 1 must be a non-empty string/,
  );
});
