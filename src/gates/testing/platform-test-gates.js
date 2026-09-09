import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../../config/defaults.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { skippedResult } from '../native-result.js';
import {
  definePlatformGate,
  readyGateSetup,
} from '../platform-gate.js';
import { runAccessibilityTestGate } from './accessibility-test-gate.js';
import { validateAccessibilityTestSetup } from './accessibility-test-setup.js';
import { runUnitTestGate } from './unit-test-gate.js';
import { inspectUnitTestPolicy, unitTestPolicyFindings } from './unit-test-policy.js';
import { validateUnitTestSetup } from './unit-test-setup.js';

function processExecutionOptions({ environment, logger, signal }) {
  const liveOutput = environment === 'pre-push';
  return {
    signal,
    liveOutput,
    writeProgress: liveOutput ? logger.info : null,
  };
}

function inspectUnitTestSetup({ root, config }) {
  if (!config.checks.unitTest.enabled) return readyGateSetup('单元测试门禁已禁用');
  const resolved = validateUnitTestSetup(root, unitTestOptions(config.checks));
  return readyGateSetup(`单元测试门禁（Vitest ${resolved.vitest.version})`);
}

function unitTestOptions(checks) {
  return {
    ...checks.unitTest,
    coverage: checks.coverage,
    componentInteraction: checks.componentInteraction,
  };
}

function inspectAccessibilitySetup({ root, config }) {
  if (!config.checks.accessibilityTest.enabled) return readyGateSetup('无障碍测试门禁已禁用');
  validateAccessibilityTestSetup(root, config.checks.accessibilityTest);
  return readyGateSetup('无障碍测试门禁');
}

export const unitTestGate = definePlatformGate({
  id: 'quality.unit-test', configKey: 'checks.unitTest', featureName: 'unitTest',
  featureOrder: 140, doctorOrder: 50,
  environments: ['manual', 'pre-push', 'ci-policy', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
  manualCommand: 'unit-test', manualOrder: 60, packageScript: 'guard:unit-test',
  supportsCancellation: true,
  requiredTools: ['vitest'], requiredScripts: ['config:checks.unitTest.script'],
  artifactTypes: ['coverage-report'], inspectSetup: inspectUnitTestSetup,
  plan: ({ config, step }) => ({
    enabled: config.checks.unitTest.enabled,
    policyOnly: step?.id === 'quality.unit-test-policy',
  }),
  run: ({ root, config, changes, plan, ...context }) => {
    if (!plan.enabled) return skippedResult('quality.unit-test', '单元测试已禁用');
    if (!plan.policyOnly) return runUnitTestGate({
      root,
      config: unitTestOptions(config.checks),
      changes,
      ...processExecutionOptions(context),
    });
    const policy = inspectUnitTestPolicy({ root, changes, config: unitTestOptions(config.checks) });
    const violations = policy.missingTests.length
      + policy.bypasses.length
      + policy.componentInteractions.length;
    return violations === 0
      ? createGateResult({
          gateId: 'quality.unit-test',
          status: 'passed',
          summary: '单元测试策略已通过',
        })
      : createGateResult({
          gateId: 'quality.unit-test',
          status: 'violation',
          summary: `单元测试策略发现 ${violations} 项违规`,
          findings: unitTestPolicyFindings(policy),
        });
  },
});

export const accessibilityTestGate = definePlatformGate({
  id: 'quality.accessibility-test', configKey: 'checks.accessibilityTest',
  featureName: 'accessibilityTest', featureOrder: 100, doctorOrder: 60,
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_ACCESSIBILITY_TEST_CONFIG.timeoutMs,
  manualCommand: 'accessibility-test', manualOrder: 120,
  packageScript: 'guard:accessibility-test',
  supportsCancellation: true,
  requiredScripts: ['config:checks.accessibilityTest.script'],
  inspectSetup: inspectAccessibilitySetup,
  plan: ({ config }) => ({ enabled: config.checks.accessibilityTest.enabled }),
  run: ({ root, config, plan, ...context }) => plan.enabled
    ? runAccessibilityTestGate({
        root,
        config: config.checks.accessibilityTest,
        ...processExecutionOptions(context),
      })
    : skippedResult('quality.accessibility-test', '无障碍测试已禁用'),
});
