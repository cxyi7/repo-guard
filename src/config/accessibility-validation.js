import { DEFAULT_ACCESSIBILITY_TEST_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

export function validateAccessibilityConfiguration(value, configPath) {
  const accessibilityTestValue = value.accessibilityTest ?? {};
  if (
    !accessibilityTestValue
    || typeof accessibilityTestValue !== 'object'
    || Array.isArray(accessibilityTestValue)
  ) {
    throw configValidationError(`${configPath} accessibilityTest 必须是对象`);
  }
  assertKnownProperties(
    accessibilityTestValue,
    new Set(['enabled', 'script', 'timeoutMs', 'testPatterns']),
    `${configPath} accessibilityTest`,
  );
  if (
    accessibilityTestValue.enabled != null
    && typeof accessibilityTestValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} accessibilityTest.enabled 必须是布尔值`);
  }
  if (
    accessibilityTestValue.script != null
    && (
      typeof accessibilityTestValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(accessibilityTestValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} accessibilityTest.script 必须是 npm 脚本名称`);
  }
  if (
    accessibilityTestValue.timeoutMs != null
    && (
      !Number.isInteger(accessibilityTestValue.timeoutMs)
      || accessibilityTestValue.timeoutMs <= 0
    )
  ) {
    throw configValidationError(`${configPath} accessibilityTest.timeoutMs 必须是正整数`);
  }
  const accessibilityTestPatterns = normalizePatternList(
    accessibilityTestValue.testPatterns ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.testPatterns,
    `${configPath} accessibilityTest.testPatterns`,
  );

  return {
    enabled: accessibilityTestValue.enabled
      ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.enabled,
    script: accessibilityTestValue.script?.trim()
      || DEFAULT_ACCESSIBILITY_TEST_CONFIG.script,
    timeoutMs: accessibilityTestValue.timeoutMs
      ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.timeoutMs,
    testPatterns: accessibilityTestPatterns,
  };
}
