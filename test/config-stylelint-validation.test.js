import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLELINT_CONFIG } from '../src/config/defaults.js';
import { validateStylelintConfiguration } from '../src/config/stylelint-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies Stylelint defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateStylelintConfiguration({}, CONFIG_PATH),
    DEFAULT_STYLELINT_CONFIG,
  );
});

test('normalizes Stylelint execution, complexity, and governance settings', () => {
  assert.deepEqual(validateStylelintConfiguration({
    stylelint: {
      enabled: true,
      pattern: ' src/**/*.{css,vue} ',
      fix: false,
      maxWarnings: 3,
      requireConfig: false,
      complexity: {
        enabled: true,
        maxCompoundSelectors: 4,
        maxNestingDepth: 2,
      },
      governance: {
        enabled: true,
        maxSpecificity: ' 0,3,1 ',
        maxIdSelectors: 1,
        disallowImportant: false,
        allowedGlobalStylePatterns: [' src/styles/** ', ' packages/*/theme.css '],
      },
    },
  }, CONFIG_PATH), {
    enabled: true,
    pattern: 'src/**/*.{css,vue}',
    fix: false,
    maxWarnings: 3,
    requireConfig: false,
    complexity: {
      enabled: true,
      maxCompoundSelectors: 4,
      maxNestingDepth: 2,
    },
    governance: {
      enabled: true,
      maxSpecificity: '0,3,1',
      maxIdSelectors: 1,
      disallowImportant: false,
      allowedGlobalStylePatterns: ['src/styles/**', 'packages/*/theme.css'],
    },
  });
});

test('requires a Stylelint object with valid execution settings', () => {
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: [] }, CONFIG_PATH),
    /preCommit\.stylelint must be an object/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { command: 'lint' } }, CONFIG_PATH),
    /has unsupported properties: command/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { enabled: 'yes' } }, CONFIG_PATH),
    /stylelint\.enabled must be a boolean/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { pattern: '  ' } }, CONFIG_PATH),
    /stylelint\.pattern must be a non-empty string/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { fix: 'yes' } }, CONFIG_PATH),
    /stylelint\.fix must be a boolean/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { maxWarnings: -1 } }, CONFIG_PATH),
    /stylelint\.maxWarnings must be a non-negative integer/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { requireConfig: 'yes' } }, CONFIG_PATH),
    /stylelint\.requireConfig must be a boolean/,
  );
});

test('requires valid Stylelint complexity settings and their parent gate', () => {
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { complexity: [] } }, CONFIG_PATH),
    /stylelint\.complexity must be an object/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { complexity: { maxNestingDepth: -1 } },
    }, CONFIG_PATH),
    /complexity\.maxNestingDepth must be a non-negative integer/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { enabled: false, complexity: { enabled: true } },
    }, CONFIG_PATH),
    /complexity\.enabled requires preCommit\.stylelint\.enabled/,
  );
});

test('requires valid Stylelint governance settings', () => {
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { governance: [] } }, CONFIG_PATH),
    /stylelint\.governance must be an object/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { maxSpecificity: '0,3' } },
    }, CONFIG_PATH),
    /maxSpecificity must use the "id,class,type" format/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { maxIdSelectors: -1 } },
    }, CONFIG_PATH),
    /maxIdSelectors must be a non-negative integer/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { disallowImportant: 'yes' } },
    }, CONFIG_PATH),
    /disallowImportant must be a boolean/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { allowedGlobalStylePatterns: [''] } },
    }, CONFIG_PATH),
    /allowedGlobalStylePatterns item 1 must be a non-empty string/,
  );
});

test('requires Stylelint governance to keep its parent gate enabled', () => {
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { enabled: false, governance: { enabled: true } },
    }, CONFIG_PATH),
    /governance\.enabled requires preCommit\.stylelint\.enabled/,
  );
});
