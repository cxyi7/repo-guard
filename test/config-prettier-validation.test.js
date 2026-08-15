import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PRETTIER_CONFIG } from '../src/config/defaults.js';
import { validatePrettierConfiguration } from '../src/config/prettier-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies Prettier defaults when configuration is omitted', () => {
  assert.deepEqual(
    validatePrettierConfiguration({}, CONFIG_PATH),
    DEFAULT_PRETTIER_CONFIG,
  );
});

test('normalizes Prettier staged formatting settings', () => {
  assert.deepEqual(validatePrettierConfiguration({
    prettier: {
      enabled: false,
      pattern: ' src/**/*.{js,json,css} ',
      fix: false,
      requireConfig: false,
    },
  }, CONFIG_PATH), {
    enabled: false,
    pattern: 'src/**/*.{js,json,css}',
    fix: false,
    requireConfig: false,
  });
});

test('requires a Prettier object with supported properties', () => {
  assert.throws(
    () => validatePrettierConfiguration({ prettier: [] }, CONFIG_PATH),
    /preCommit\.prettier must be an object/,
  );
  assert.throws(
    () => validatePrettierConfiguration({
      prettier: { command: 'prettier --write' },
    }, CONFIG_PATH),
    /has unsupported properties: command/,
  );
});

test('requires valid Prettier staged formatting settings', () => {
  assert.throws(
    () => validatePrettierConfiguration({ prettier: { enabled: 'yes' } }, CONFIG_PATH),
    /prettier\.enabled must be a boolean/,
  );
  assert.throws(
    () => validatePrettierConfiguration({ prettier: { pattern: '  ' } }, CONFIG_PATH),
    /prettier\.pattern must be a non-empty string/,
  );
  assert.throws(
    () => validatePrettierConfiguration({ prettier: { fix: 'yes' } }, CONFIG_PATH),
    /prettier\.fix must be a boolean/,
  );
  assert.throws(
    () => validatePrettierConfiguration({
      prettier: { requireConfig: 'yes' },
    }, CONFIG_PATH),
    /prettier\.requireConfig must be a boolean/,
  );
});
