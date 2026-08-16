import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../../config/defaults.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  isAccessibilityTestPolicyCurrent,
  isUnitTestPolicyCurrent,
  UNIT_TEST_POLICY_FILE,
} from '../../policies/managed-policies.js';
import { skippedResult } from '../native-result.js';
import {
  definePlatformGate,
  policyFileIsCurrent,
  readyGateSetup,
} from '../platform-gate.js';
import { runAccessibilityTestGate } from './accessibility-test-gate.js';
import { validateAccessibilityTestSetup } from './accessibility-test-setup.js';
import { runUnitTestGate } from './unit-test-gate.js';
import { inspectUnitTestPolicy, unitTestPolicyFindings } from './unit-test-policy.js';
import { validateUnitTestSetup } from './unit-test-setup.js';

function inspectUnitTestSetup({ root, config }) {
  if (!config.unitTest.enabled) return readyGateSetup('Unit test gate is disabled');
  const resolved = validateUnitTestSetup(root, config.unitTest);
  if (!policyFileIsCurrent(
    root,
    UNIT_TEST_POLICY_FILE,
    isUnitTestPolicyCurrent,
    config.unitTest,
  )) {
    throw configurationError(
      'unit-test/missing-managed-policy',
      `${UNIT_TEST_POLICY_FILE} is missing the current unit test policy`,
      { details: { location: { path: UNIT_TEST_POLICY_FILE } } },
    );
  }
  return readyGateSetup(`Unit test gate (Vitest ${resolved.vitest.version})`);
}

function inspectAccessibilitySetup({ root, config }) {
  if (!config.accessibilityTest.enabled) return readyGateSetup('Accessibility test gate is disabled');
  validateAccessibilityTestSetup(root, config.accessibilityTest);
  if (!policyFileIsCurrent(
    root,
    ACCESSIBILITY_TEST_POLICY_FILE,
    isAccessibilityTestPolicyCurrent,
    config.accessibilityTest,
  )) {
    throw configurationError(
      'accessibility-test/missing-managed-policy',
      `${ACCESSIBILITY_TEST_POLICY_FILE} is missing the current accessibility policy`,
      { details: { location: { path: ACCESSIBILITY_TEST_POLICY_FILE } } },
    );
  }
  return readyGateSetup('Accessibility test gate');
}

export const unitTestGate = definePlatformGate({
  id: 'quality.unit-test', configKey: 'unitTest', featureName: 'unitTest',
  featureOrder: 140, doctorOrder: 50,
  environments: ['manual', 'pre-push', 'ci-policy', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
  manualCommand: 'unit-test', manualOrder: 60, packageScript: 'guard:unit-test',
  requiredTools: ['vitest'], requiredScripts: ['config:unitTest.script'],
  artifactTypes: ['coverage-report'], inspectSetup: inspectUnitTestSetup,
  plan: ({ config, step }) => ({
    enabled: config.unitTest.enabled,
    policyOnly: step?.id === 'quality.unit-test-policy',
  }),
  run: ({ root, config, changes, plan }) => {
    if (!plan.enabled) return skippedResult('quality.unit-test', 'Unit tests are disabled');
    if (!plan.policyOnly) return runUnitTestGate({ root, config: config.unitTest, changes });
    const policy = inspectUnitTestPolicy({ root, changes, config: config.unitTest });
    const violations = policy.missingTests.length
      + policy.bypasses.length
      + policy.componentInteractions.length;
    return violations === 0
      ? createGateResult({
          gateId: 'quality.unit-test',
          status: 'passed',
          summary: 'Unit test policy passed',
        })
      : createGateResult({
          gateId: 'quality.unit-test',
          status: 'violation',
          summary: `Unit test policy found ${violations} violation(s)`,
          findings: unitTestPolicyFindings(policy),
        });
  },
});

export const accessibilityTestGate = definePlatformGate({
  id: 'quality.accessibility-test', configKey: 'accessibilityTest',
  featureName: 'accessibilityTest', featureOrder: 100, doctorOrder: 60,
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_ACCESSIBILITY_TEST_CONFIG.timeoutMs,
  manualCommand: 'accessibility-test', manualOrder: 120,
  packageScript: 'guard:accessibility-test',
  requiredScripts: ['config:accessibilityTest.script'],
  inspectSetup: inspectAccessibilitySetup,
  plan: ({ config }) => ({ enabled: config.accessibilityTest.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runAccessibilityTestGate({ root, config: config.accessibilityTest })
    : skippedResult('quality.accessibility-test', 'Accessibility tests are disabled'),
});
