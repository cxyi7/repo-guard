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
    /preCommit\.stylelint 必须是对象/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { command: 'lint' } }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { enabled: 'yes' } }, CONFIG_PATH),
    /stylelint\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { pattern: '  ' } }, CONFIG_PATH),
    /stylelint\.pattern 必须是非空字符串/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { fix: 'yes' } }, CONFIG_PATH),
    /stylelint\.fix 必须是布尔值/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { maxWarnings: -1 } }, CONFIG_PATH),
    /stylelint\.maxWarnings 必须是非负整数/,
  );
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { requireConfig: 'yes' } }, CONFIG_PATH),
    /stylelint\.requireConfig 必须是布尔值/,
  );
});

test('requires valid Stylelint complexity settings and their parent gate', () => {
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { complexity: [] } }, CONFIG_PATH),
    /stylelint\.complexity 必须是对象/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { complexity: { maxNestingDepth: -1 } },
    }, CONFIG_PATH),
    /complexity\.maxNestingDepth 必须是非负整数/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { enabled: false, complexity: { enabled: true } },
    }, CONFIG_PATH),
    /complexity\.enabled 要求启用 preCommit\.stylelint\.enabled/,
  );
});

test('requires valid Stylelint governance settings', () => {
  assert.throws(
    () => validateStylelintConfiguration({ stylelint: { governance: [] } }, CONFIG_PATH),
    /stylelint\.governance 必须是对象/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { maxSpecificity: '0,3' } },
    }, CONFIG_PATH),
    /maxSpecificity 必须使用 "id,class,type" 格式/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { maxIdSelectors: -1 } },
    }, CONFIG_PATH),
    /maxIdSelectors 必须是非负整数/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { disallowImportant: 'yes' } },
    }, CONFIG_PATH),
    /disallowImportant 必须是布尔值/,
  );
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { governance: { allowedGlobalStylePatterns: [''] } },
    }, CONFIG_PATH),
    /allowedGlobalStylePatterns 第 1 必须是非空字符串/,
  );
});

test('requires Stylelint governance to keep its parent gate enabled', () => {
  assert.throws(
    () => validateStylelintConfiguration({
      stylelint: { enabled: false, governance: { enabled: true } },
    }, CONFIG_PATH),
    /governance\.enabled 要求启用 preCommit\.stylelint\.enabled/,
  );
});
