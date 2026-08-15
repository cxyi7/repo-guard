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
    /unitTest must be an object/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { command: 'test:unit' } }, CONFIG_PATH),
    /has unsupported properties: command/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { enabled: 'yes' } }, CONFIG_PATH),
    /unitTest\.enabled must be a boolean/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { script: 'npm run test:unit' },
    }, CONFIG_PATH),
    /unitTest\.script must be an npm script name/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { timeoutMs: 0 } }, CONFIG_PATH),
    /unitTest\.timeoutMs must be a positive integer/,
  );
});

test('validates coverage directories and thresholds', () => {
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { coverage: [] } }, CONFIG_PATH),
    /unitTest\.coverage must be an object/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { coverage: { reportsDirectory: 'src' } },
    }, CONFIG_PATH),
    /must be a dedicated coverage directory/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { coverage: { thresholds: { changedLines: 101 } } },
    }, CONFIG_PATH),
    /changedLines must be between 0 and 100/,
  );
});

test('validates component interaction and test selection settings', () => {
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { componentInteraction: { enabled: true } },
    }, CONFIG_PATH),
    /componentInteraction\.enabled requires unitTest\.enabled/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { requireTests: 'all' },
    }, CONFIG_PATH),
    /requireTests must be newFiles or changedFiles/,
  );
  assert.throws(
    () => validateUnitTestConfiguration({
      unitTest: { sourcePatterns: [] },
    }, CONFIG_PATH),
    /sourcePatterns must be a non-empty array/,
  );
});

test('validates unit test mapping templates', () => {
  assert.throws(
    () => validateUnitTestConfiguration({ unitTest: { mappings: [] } }, CONFIG_PATH),
    /unitTest\.mappings must be a non-empty array/,
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
    /unsupported placeholder/,
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
    /must contain \{path\} or \{name\}/,
  );
});
