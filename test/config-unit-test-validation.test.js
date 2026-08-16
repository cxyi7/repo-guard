import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_UNIT_TEST_CONFIG } from '../src/config/defaults.js';
import { validateUnitTestConfiguration } from '../src/config/unit-test-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies unit test defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateUnitTestConfiguration({}, CONFIG_PATH),
    DEFAULT_UNIT_TEST_CONFIG,
  );
});

test('normalizes unit test execution, coverage, interaction, and mapping settings', () => {
  assert.deepEqual(validateUnitTestConfiguration({
    unitTest: {
      enabled: true,
      script: ' test:unit:ci ',
      timeoutMs: 90000,
      coverage: {
        enabled: true,
        reportsDirectory: ' reports/coverage ',
        thresholds: { lines: 85, changedLines: 95 },
      },
      componentInteraction: {
        enabled: true,
        componentPatterns: [' src/widgets/**/*.vue '],
      },
      requireTests: 'changedFiles',
      sourcePatterns: [' src/widgets/**/*.vue '],
      testPatterns: [' test/**/*.spec.ts '],
      mappings: [{
        sourcePattern: ' src/widgets/**/*.vue ',
        testTemplates: [' test/{path}.spec.ts '],
      }],
      exclusions: [],
    },
  }, CONFIG_PATH), {
    enabled: true,
    script: 'test:unit:ci',
    timeoutMs: 90000,
    coverage: {
      enabled: true,
      reportsDirectory: 'reports/coverage',
      thresholds: {
        lines: 85,
        statements: 80,
        functions: 80,
        branches: 80,
        changedLines: 95,
      },
    },
    componentInteraction: {
      enabled: true,
      componentPatterns: ['src/widgets/**/*.vue'],
    },
    requireTests: 'changedFiles',
    sourcePatterns: ['src/widgets/**/*.vue'],
    testPatterns: ['test/**/*.spec.ts'],
    mappings: [{
      sourcePattern: 'src/widgets/**/*.vue',
      testTemplates: ['test/{path}.spec.ts'],
    }],
    exclusions: [],
  });
});

test('requires a unit test object with valid execution settings', () => {
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: [] }, CONFIG_PATH),
    /unitTest 必须是对象/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { command: 'test:unit' } }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { enabled: 'yes' } }, CONFIG_PATH),
    /unitTest\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { script: 'npm run test:unit' },
    }, CONFIG_PATH),
    /unitTest\.script 必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { timeoutMs: 0 } }, CONFIG_PATH),
    /unitTest\.timeoutMs 必须是正整数/,
  );
});

test('validates coverage directories and thresholds', () => {
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { coverage: [] } }, CONFIG_PATH),
    /unitTest\.coverage 必须是对象/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { coverage: { reportsDirectory: 'src' } },
    }, CONFIG_PATH),
    /必须是专用的覆盖率目录/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { coverage: { thresholds: { changedLines: 101 } } },
    }, CONFIG_PATH),
    /changedLines 必须介于 0 到 100 之间/,
  );
});

test('validates component interaction and test selection settings', () => {
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { componentInteraction: { enabled: true } },
    }, CONFIG_PATH),
    /componentInteraction\.enabled 要求启用 unitTest\.enabled/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { requireTests: 'all' },
    }, CONFIG_PATH),
    /requireTests 必须为 newFiles 或 changedFiles/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { sourcePatterns: [] },
    }, CONFIG_PATH),
    /sourcePatterns 必须是非空数组/,
  );
});

test('validates unit test mapping templates', () => {
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { mappings: [] } }, CONFIG_PATH),
    /unitTest\.mappings 必须是非空数组/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: {
        mappings: [{
          sourcePattern: '**/*.ts',
          testTemplates: ['{unknown}.spec.ts'],
        }],
      },
    }, CONFIG_PATH),
    /不支持的占位符/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: {
        mappings: [{
          sourcePattern: '**/*.ts',
          testTemplates: ['tests/all.spec.ts'],
        }],
      },
    }, CONFIG_PATH),
    /必须包含 \{path\} 或 \{name\}/,
  );
});
