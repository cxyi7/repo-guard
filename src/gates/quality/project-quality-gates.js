import {
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_DEAD_CODE_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
} from '../../config/defaults.js';
import { validateArchitectureSetup } from '../../integrations/dependency-cruiser/architecture.js';
import { validateVueLighthouseSetup } from '../../integrations/lighthouse/project.js';
import { validateBuildSetup } from '../../integrations/npm/build.js';
import { validateTypeCheckSetup } from '../../integrations/npm/typecheck.js';
import { skippedResult } from '../native-result.js';
import {
  definePlatformGate,
  readyGateSetup,
} from '../platform-gate.js';
import { runArchitectureGate } from './architecture-gate.js';
import { runBuildGate } from './build-gate.js';
import { runDeadCodeGate } from './dead-code-gate.js';
import { validateDeadCodeSetup } from './dead-code-setup.js';
import { runVueLighthouse } from './lighthouse-gate.js';
import { runTypeCheckGate } from './typecheck-gate.js';

function processExecutionOptions({ environment, logger, signal }) {
  const liveOutput = environment === 'pre-push';
  return {
    signal,
    liveOutput,
    writeProgress: liveOutput ? logger.info : null,
  };
}

function inspectBuildSetup({ root, config }) {
  if (!config.checks.build.enabled) return readyGateSetup('构建门禁已禁用');
  validateBuildSetup(root, config.checks.build);
  return readyGateSetup(`构建门禁（脚本=${config.checks.build.script})`);
}

function inspectArchitectureSetup({ root, config }) {
  if (!config.checks.architecture.enabled) return readyGateSetup('架构门禁已禁用');
  const resolved = validateArchitectureSetup(root, config.checks.architecture);
  return readyGateSetup(`架构门禁（dependency-cruiser ${resolved.dependencyCruiser.version})`);
}

function inspectDeadCodeSetup({ root, config }) {
  if (!config.checks.deadCode.enabled) return readyGateSetup('无效代码门禁已禁用');
  const resolved = validateDeadCodeSetup(root, config.checks.deadCode);
  return readyGateSetup(`无效代码门禁（Knip ${resolved.knip.version}）`);
}

function inspectLighthouseSetup({ root, config }) {
  if (!config.checks.lighthouse.enabled) return readyGateSetup('Lighthouse 门禁已禁用');
  const resolved = validateVueLighthouseSetup(root, config.checks.lighthouse);
  return readyGateSetup(`Lighthouse 门禁（@lhci/cli ${resolved.lighthouse.version})`);
}

function inspectTypecheckSetup({ root, config }) {
  if (!config.checks.typeCheck.enabled) return readyGateSetup('类型检查门禁已禁用');
  validateTypeCheckSetup(root, config.checks.typeCheck);
  return readyGateSetup(`类型检查门禁（脚本=${config.checks.typeCheck.script})`);
}

export const typecheckGate = definePlatformGate({
  id: 'quality.typecheck', configKey: 'checks.typeCheck', featureName: 'typeCheck',
  featureOrder: 130, doctorOrder: 40, environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_TYPE_CHECK_CONFIG.timeoutMs,
  manualCommand: 'typecheck', manualOrder: 50, packageScript: 'guard:typecheck',
  supportsCancellation: true,
  requiredScripts: ['config:checks.typeCheck.script'], inspectSetup: inspectTypecheckSetup,
  plan: ({ config }) => ({ enabled: config.checks.typeCheck.enabled }),
  run: ({ root, config, plan, ...context }) => plan.enabled
    ? runTypeCheckGate({
        root,
        config: config.checks.typeCheck,
        ...processExecutionOptions(context),
      })
    : skippedResult('quality.typecheck', '类型检查已禁用'),
});

export const architectureGate = definePlatformGate({
  id: 'quality.architecture', configKey: 'checks.architecture', featureName: 'architecture',
  featureOrder: 90, doctorOrder: 20, environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_ARCHITECTURE_CONFIG.timeoutMs,
  manualCommand: 'architecture', manualOrder: 40, packageScript: 'guard:architecture',
  requiredTools: ['dependency-cruiser'], inspectSetup: inspectArchitectureSetup,
  plan: ({ config }) => ({ enabled: config.checks.architecture.enabled }),
  run: ({ root, config, plan, ...context }) => plan.enabled
    ? runArchitectureGate({
        root,
        config: config.checks.architecture,
        ...processExecutionOptions(context),
      })
    : skippedResult('quality.architecture', '架构门禁已禁用'),
});

export const deadCodeGate = definePlatformGate({
  id: 'quality.dead-code', configKey: 'checks.deadCode', featureName: 'deadCode',
  featureOrder: 100, doctorOrder: 25, environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_DEAD_CODE_CONFIG.timeoutMs,
  manualCommand: 'dead-code', manualOrder: 45, packageScript: 'guard:dead-code',
  requiredTools: ['knip'], supportsCancellation: true,
  inspectSetup: inspectDeadCodeSetup,
  plan: ({ config, environment }) => ({
    enabled: environment === 'manual' || config.checks.deadCode.enabled,
  }),
  run: (context) => context.plan.enabled
    ? runDeadCodeGate(context)
    : skippedResult('quality.dead-code', '无效代码门禁已禁用'),
});

export const buildGate = definePlatformGate({
  id: 'quality.build', configKey: 'checks.build', featureName: 'build',
  featureOrder: 110, doctorOrder: 10,
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_BUILD_CONFIG.timeoutMs,
  manualCommand: 'build', manualOrder: 30, packageScript: 'guard:build',
  supportsCancellation: true,
  requiredScripts: ['config:checks.build.script'], artifactTypes: ['build-output'],
  inspectSetup: inspectBuildSetup, plan: ({ config }) => ({ enabled: config.checks.build.enabled }),
  run: ({ root, config, plan, ...context }) => plan.enabled
    ? runBuildGate({
        root,
        config: config.checks.build,
        ...processExecutionOptions(context),
      })
    : skippedResult('quality.build', '构建已禁用'),
});

export const lighthouseGate = definePlatformGate({
  id: 'quality.lighthouse', configKey: 'checks.lighthouse', featureName: 'lighthouse',
  featureOrder: 120, doctorOrder: 30,
  environments: ['manual', 'pre-push', 'release-ready'],
  defaultTimeoutMs: DEFAULT_LIGHTHOUSE_CONFIG.timeoutMs,
  manualCommand: 'lighthouse', manualOptions: ['--skip-build'], manualOrder: 160,
  packageScript: 'guard:lighthouse', requiredTools: ['@lhci/cli'],
  artifactTypes: ['lighthouse-report'], inspectSetup: inspectLighthouseSetup,
  plan: ({ config, environment, argumentsList = [] }) => ({
    enabled: environment === 'manual' || config.checks.lighthouse.enabled,
    skipBuild: argumentsList.includes('--skip-build')
      || (config.checks.build.enabled && config.checks.lighthouse.buildScript === config.checks.build.script),
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runVueLighthouse({ root, config: config.checks.lighthouse, skipBuild: plan.skipBuild })
    : skippedResult('quality.lighthouse', 'Lighthouse 已禁用'),
});
