import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ACCESSIBILITY_TEST_CONFIG } from '../src/config/defaults.js';
import { validateAccessibilityConfiguration } from '../src/config/accessibility-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies accessibility test defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateAccessibilityConfiguration({}, CONFIG_PATH),
    DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  );
});

test('normalizes accessibility test execution settings and patterns', () => {
  assert.deepEqual(validateAccessibilityConfiguration({
    accessibilityTest: {
      enabled: true,
      script: ' test:a11y:e2e ',
      timeoutMs: 90000,
      testPatterns: [' e2e/accessibility/**/*.spec.ts '],
    },
  }, CONFIG_PATH), {
    enabled: true,
    script: 'test:a11y:e2e',
    timeoutMs: 90000,
    testPatterns: ['e2e/accessibility/**/*.spec.ts'],
  });
});

test('requires an accessibility test object and boolean switch', () => {
  assert.throws(
    () => validateAccessibilityConfiguration({ accessibilityTest: [] }, CONFIG_PATH),
    /accessibilityTest must be an object/,
  );
  assert.throws(
    () => validateAccessibilityConfiguration({
      accessibilityTest: { enabled: 'yes' },
    }, CONFIG_PATH),
    /accessibilityTest\.enabled must be a boolean/,
  );
});

test('rejects unknown properties and invalid execution settings', () => {
  assert.throws(
    () => validateAccessibilityConfiguration({
      accessibilityTest: { command: 'test:a11y' },
    }, CONFIG_PATH),
    /has unsupported properties: command/,
  );
  assert.throws(
    () => validateAccessibilityConfiguration({
      accessibilityTest: { script: 'playwright test' },
    }, CONFIG_PATH),
    /accessibilityTest\.script must be an npm script name/,
  );
  assert.throws(
    () => validateAccessibilityConfiguration({
      accessibilityTest: { timeoutMs: 0 },
    }, CONFIG_PATH),
    /accessibilityTest\.timeoutMs must be a positive integer/,
  );
  assert.throws(
    () => validateAccessibilityConfiguration({
      accessibilityTest: { testPatterns: [] },
    }, CONFIG_PATH),
    /accessibilityTest\.testPatterns must be a non-empty array/,
  );
});
