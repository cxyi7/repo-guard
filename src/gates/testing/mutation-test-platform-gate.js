import { DEFAULT_MUTATION_TEST_CONFIG } from '../../config/defaults.js';
import { resolveMutationTestSetup } from '../../integrations/stryker/project.js';
import { skippedResult } from '../native-result.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';
import { runMutationTestGate } from './mutation-test-gate.js';

function inspectMutationTestSetup({ root, config }) {
  if (!config.checks.mutationTest.enabled) return readyGateSetup('变异测试门禁已禁用');
  const setup = resolveMutationTestSetup(root, config.checks.mutationTest);
  return readyGateSetup(`变异测试门禁（Stryker ${setup.version}）`);
}

export const mutationTestGate = definePlatformGate({
  id: 'quality.mutation-test',
  configKey: 'checks.mutationTest',
  featureName: 'mutationTest',
  featureOrder: 145,
  doctorOrder: 55,
  environments: ['manual'],
  defaultTimeoutMs: DEFAULT_MUTATION_TEST_CONFIG.timeoutMs,
  manualCommand: 'mutation-test',
  manualOrder: 65,
  packageScript: 'guard:mutation-test',
  supportsCancellation: true,
  requiredTools: ['@stryker-mutator/core'],
  artifactTypes: [
    'mutation-report-json',
    'mutation-report-html',
    'mutation-report-original-html',
  ],
  inspectSetup: inspectMutationTestSetup,
  plan: ({ config }) => ({ enabled: config.checks.mutationTest.enabled }),
  run: ({ root, config, plan, signal, environment }) => {
    if (!plan.enabled) return skippedResult('quality.mutation-test', '变异测试已禁用');
    return runMutationTestGate({
      root,
      config: config.checks.mutationTest,
      setup: resolveMutationTestSetup(root, config.checks.mutationTest),
      signal,
      liveOutput: environment === 'manual',
    });
  },
});
