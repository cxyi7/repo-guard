import {
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
} from '../../config/defaults.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { validateArchitectureSetup } from '../../integrations/dependency-cruiser/architecture.js';
import { validateVueLighthouseSetup } from '../../integrations/lighthouse/project.js';
import { validateBuildSetup } from '../../integrations/npm/build.js';
import { validateTypeCheckSetup } from '../../integrations/npm/typecheck.js';
import {
  ARCHITECTURE_POLICY_FILE,
  isArchitecturePolicyCurrent,
} from '../../policies/managed-policies.js';
import { skippedResult } from '../native-result.js';
import {
  definePlatformGate,
  policyFileIsCurrent,
  readyGateSetup,
} from '../platform-gate.js';
import { runArchitectureGate } from './architecture-gate.js';
import { runBuildGate } from './build-gate.js';
import { runVueLighthouse } from './lighthouse-gate.js';
import { runTypeCheckGate } from './typecheck-gate.js';

function inspectBuildSetup({ root, config }) {
  if (!config.build.enabled) return readyGateSetup('Build gate is disabled');
  validateBuildSetup(root, config.build);
  return readyGateSetup(`Build gate (script=${config.build.script})`);
}

function inspectArchitectureSetup({ root, config }) {
  if (!config.architecture.enabled) return readyGateSetup('Architecture gate is disabled');
  const resolved = validateArchitectureSetup(root, config.architecture);
  if (!policyFileIsCurrent(
    root,
    ARCHITECTURE_POLICY_FILE,
    isArchitecturePolicyCurrent,
    config.architecture,
  )) {
    throw configurationError(
      'architecture/missing-managed-policy',
      `${ARCHITECTURE_POLICY_FILE} is missing the current architecture policy`,
      { details: { location: { path: ARCHITECTURE_POLICY_FILE } } },
    );
  }
  return readyGateSetup(`Architecture gate (dependency-cruiser ${resolved.dependencyCruiser.version})`);
}

function inspectLighthouseSetup({ root, config }) {
  if (!config.lighthouse.enabled) return readyGateSetup('Lighthouse gate is disabled');
  const resolved = validateVueLighthouseSetup(root, config.lighthouse);
  return readyGateSetup(`Lighthouse gate (@lhci/cli ${resolved.lighthouse.version})`);
}

function inspectTypecheckSetup({ root, config }) {
  if (!config.typeCheck.enabled) return readyGateSetup('Type check gate is disabled');
  validateTypeCheckSetup(root, config.typeCheck);
  return readyGateSetup(`Type check gate (script=${config.typeCheck.script})`);
}

export const typecheckGate = definePlatformGate({
  id: 'quality.typecheck', configKey: 'typeCheck', featureName: 'typeCheck',
  featureOrder: 130, doctorOrder: 40, environments: ['manual', 'pre-push', 'ci-full'],
  defaultTimeoutMs: DEFAULT_TYPE_CHECK_CONFIG.timeoutMs,
  manualCommand: 'typecheck', manualOrder: 50, packageScript: 'guard:typecheck',
  requiredScripts: ['config:typeCheck.script'], inspectSetup: inspectTypecheckSetup,
  plan: ({ config }) => ({ enabled: config.typeCheck.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runTypeCheckGate({ root, config: config.typeCheck })
    : skippedResult('quality.typecheck', 'Type check is disabled'),
});

export const architectureGate = definePlatformGate({
  id: 'quality.architecture', configKey: 'architecture', featureName: 'architecture',
  featureOrder: 90, doctorOrder: 20, environments: ['manual', 'pre-push', 'ci-full'],
  defaultTimeoutMs: DEFAULT_ARCHITECTURE_CONFIG.timeoutMs,
  manualCommand: 'architecture', manualOrder: 40, packageScript: 'guard:architecture',
  requiredTools: ['dependency-cruiser'], inspectSetup: inspectArchitectureSetup,
  plan: ({ config }) => ({ enabled: config.architecture.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runArchitectureGate({ root, config: config.architecture })
    : skippedResult('quality.architecture', 'Architecture gate is disabled'),
});

export const buildGate = definePlatformGate({
  id: 'quality.build', configKey: 'build', featureName: 'build',
  featureOrder: 110, doctorOrder: 10,
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_BUILD_CONFIG.timeoutMs,
  manualCommand: 'build', manualOrder: 30, packageScript: 'guard:build',
  requiredScripts: ['config:build.script'], artifactTypes: ['build-output'],
  inspectSetup: inspectBuildSetup, plan: ({ config }) => ({ enabled: config.build.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runBuildGate({ root, config: config.build })
    : skippedResult('quality.build', 'Build is disabled'),
});

export const lighthouseGate = definePlatformGate({
  id: 'quality.lighthouse', configKey: 'lighthouse', featureName: 'lighthouse',
  featureOrder: 120, doctorOrder: 30,
  environments: ['manual', 'pre-push', 'release-ready'],
  defaultTimeoutMs: DEFAULT_LIGHTHOUSE_CONFIG.timeoutMs,
  manualCommand: 'lighthouse', manualOptions: ['--skip-build'], manualOrder: 160,
  packageScript: 'guard:lighthouse', requiredTools: ['@lhci/cli'],
  artifactTypes: ['lighthouse-report'], inspectSetup: inspectLighthouseSetup,
  plan: ({ config, environment, argumentsList = [] }) => ({
    enabled: environment === 'manual' || config.lighthouse.enabled,
    skipBuild: argumentsList.includes('--skip-build')
      || (config.build.enabled && config.lighthouse.buildScript === config.build.script),
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runVueLighthouse({ root, config: config.lighthouse, skipBuild: plan.skipBuild })
    : skippedResult('quality.lighthouse', 'Lighthouse is disabled'),
});
