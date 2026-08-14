import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  ARCHITECTURE_POLICY_FILE,
  isAccessibilityTestPolicyCurrent,
  isArchitecturePolicyCurrent,
  isUnitTestPolicyCurrent,
  UNIT_TEST_POLICY_FILE,
} from '../policies/managed-policies.js';
import {
  runAccessibilityTestGate,
  validateAccessibilityTestSetup,
} from '../accessibility-test-runner.js';
import { runArchitectureGate, validateArchitectureSetup } from '../architecture-runner.js';
import { runBuildGate } from './quality/build-gate.js';
import { validateBuildSetup } from '../integrations/npm/build.js';
import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../config.js';
import { defineGate } from '../core/capability/gate-definition.js';
import { configurationError } from '../core/error/repo-guard-error.js';
import { createGateResult } from '../core/result/gate-result.js';
import {
  runEslintFiles,
  resolveProjectEslintMetadata,
  resolveRepoGuardEslintPreset,
} from '../eslint-runner.js';
import { validateVueLighthouseSetup } from '../integrations/lighthouse/project.js';
import { runVueLighthouse } from './quality/lighthouse-gate.js';
import {
  runPrettierFiles,
  resolveProjectPrettierConfigFile,
  resolveProjectPrettierMetadata,
} from '../prettier-runner.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from '../integrations/stylelint/project.js';
import {
  runStyleComplexityProject,
  runStyleGovernanceProject,
  runStylelintFiles,
} from '../stylelint-runner.js';
import {
  inspectUnitTestPolicy,
  runUnitTestGate,
  unitTestPolicyFindings,
  validateUnitTestSetup,
} from '../unit-test-runner.js';
import { runTypeCheckGate, validateTypeCheckSetup } from '../typecheck-runner.js';
import { skippedResult } from './native-result.js';

const CONFIG_VERSION = [1];
const STYLE_FILE = /\.(?:css|scss|sass|less|vue)$/i;

function ready(summary) {
  return { status: 'ready', summary };
}

function policyFileIsCurrent(root, file, predicate, config) {
  const target = path.join(root, file);
  return existsSync(target) && predicate(readFileSync(target, 'utf8'), config);
}

const setup = {
  build({ root, config }) {
    if (!config.build.enabled) return ready('Build gate is disabled');
    validateBuildSetup(root, config.build);
    return ready(`Build gate (script=${config.build.script})`);
  },
  architecture({ root, config }) {
    if (!config.architecture.enabled) return ready('Architecture gate is disabled');
    const resolved = validateArchitectureSetup(root, config.architecture);
    if (!policyFileIsCurrent(root, ARCHITECTURE_POLICY_FILE, isArchitecturePolicyCurrent, config.architecture)) {
      throw configurationError('architecture/missing-managed-policy', `${ARCHITECTURE_POLICY_FILE} is missing the current architecture policy`, {
        details: { location: { path: ARCHITECTURE_POLICY_FILE } },
      });
    }
    return ready(`Architecture gate (dependency-cruiser ${resolved.dependencyCruiser.version})`);
  },
  lighthouse({ root, config }) {
    if (!config.lighthouse.enabled) return ready('Lighthouse gate is disabled');
    const resolved = validateVueLighthouseSetup(root, config.lighthouse);
    return ready(`Lighthouse gate (@lhci/cli ${resolved.lighthouse.version})`);
  },
  typecheck({ root, config }) {
    if (!config.typeCheck.enabled) return ready('Type check gate is disabled');
    validateTypeCheckSetup(root, config.typeCheck);
    return ready(`Type check gate (script=${config.typeCheck.script})`);
  },
  unitTest({ root, config }) {
    if (!config.unitTest.enabled) return ready('Unit test gate is disabled');
    const resolved = validateUnitTestSetup(root, config.unitTest);
    if (!policyFileIsCurrent(root, UNIT_TEST_POLICY_FILE, isUnitTestPolicyCurrent, config.unitTest)) {
      throw configurationError('unit-test/missing-managed-policy', `${UNIT_TEST_POLICY_FILE} is missing the current unit test policy`, {
        details: { location: { path: UNIT_TEST_POLICY_FILE } },
      });
    }
    return ready(`Unit test gate (Vitest ${resolved.vitest.version})`);
  },
  accessibility({ root, config }) {
    if (!config.accessibilityTest.enabled) return ready('Accessibility test gate is disabled');
    validateAccessibilityTestSetup(root, config.accessibilityTest);
    if (!policyFileIsCurrent(root, ACCESSIBILITY_TEST_POLICY_FILE, isAccessibilityTestPolicyCurrent, config.accessibilityTest)) {
      throw configurationError('accessibility-test/missing-managed-policy', `${ACCESSIBILITY_TEST_POLICY_FILE} is missing the current accessibility policy`, {
        details: { location: { path: ACCESSIBILITY_TEST_POLICY_FILE } },
      });
    }
    return ready('Accessibility test gate');
  },
  async eslint({ root, config }) {
    if (!config.preCommit.eslint.enabled) return ready('ESLint gate is disabled');
    const eslint = resolveProjectEslintMetadata(root);
    if (config.preCommit.eslint.preset) await resolveRepoGuardEslintPreset(root, eslint.version);
    return ready(`ESLint ${eslint.version} gate`);
  },
  async prettier({ root, config }) {
    if (!config.preCommit.prettier.enabled) return ready('Prettier gate is disabled');
    const prettier = resolveProjectPrettierMetadata(root);
    if (config.preCommit.prettier.requireConfig && !await resolveProjectPrettierConfigFile(root)) {
      throw configurationError('prettier/missing-project-config', 'Prettier gate requires a project configuration file');
    }
    return ready(`Prettier ${prettier.version} gate`);
  },
  stylelint({ root, config }) {
    if (!config.preCommit.stylelint.enabled) return ready('Stylelint gate is disabled');
    const stylelint = resolveProjectStylelintMetadata(root);
    if (config.preCommit.stylelint.requireConfig && !findProjectStylelintConfig(root)) {
      throw configurationError('stylelint/missing-project-config', 'Stylelint gate requires a project configuration file');
    }
    return ready(`Stylelint ${stylelint.version} gate`);
  },
};

function definePlatformGate(definition) {
  return defineGate({
    configVersions: CONFIG_VERSION,
    mutation: 'read-only',
    allowedMutations: ['read-only'],
    defaultTimeoutMs: 120000,
    inspectSetup: () => null,
    ...definition,
  });
}

const stylelintGate = definePlatformGate({
  id: 'quality.stylelint',
  configKey: 'preCommit.stylelint',
  featureName: 'stylelint',
  featureOrder: 30,
  doctorOrder: 160,
  environments: ['pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  before: ['quality.eslint'],
  requiredTools: ['stylelint'],
  supportsFix: true,
  inspectSetup: setup.stylelint,
  plan: ({ config, files, step }) => ({
    enabled: config.preCommit.stylelint.enabled,
    files,
    fix: step?.mutation === 'working-tree-fix' && config.preCommit.stylelint.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runStylelintFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        maxWarnings: config.preCommit.stylelint.maxWarnings,
        requireConfig: config.preCommit.stylelint.requireConfig,
        complexity: config.preCommit.stylelint.complexity,
        governance: config.preCommit.stylelint.governance,
        exceptions: config.exceptions,
      })
    : skippedResult('quality.stylelint', 'Stylelint is disabled'),
});

const eslintGate = definePlatformGate({
  id: 'quality.eslint',
  configKey: 'preCommit.eslint',
  featureName: 'eslint',
  featureOrder: 10,
  doctorOrder: 130,
  environments: ['pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  before: ['quality.prettier'],
  requiredTools: ['eslint'],
  supportsFix: true,
  inspectSetup: setup.eslint,
  plan: ({ config, files, step }) => ({
    enabled: config.preCommit.eslint.enabled,
    files,
    fix: step?.mutation === 'working-tree-fix' && config.preCommit.eslint.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runEslintFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        maxWarnings: config.preCommit.eslint.maxWarnings,
        preset: config.preCommit.eslint.preset,
      })
    : skippedResult('quality.eslint', 'ESLint is disabled'),
});

const prettierGate = definePlatformGate({
  id: 'quality.prettier',
  configKey: 'preCommit.prettier',
  featureName: 'prettier',
  featureOrder: 20,
  doctorOrder: 170,
  environments: ['pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  requiredTools: ['prettier'],
  supportsFix: true,
  inspectSetup: setup.prettier,
  plan: ({ config, files, step }) => ({
    enabled: config.preCommit.prettier.enabled,
    files,
    fix: step?.mutation === 'working-tree-fix' && config.preCommit.prettier.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runPrettierFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        requireConfig: config.preCommit.prettier.requireConfig,
      })
    : skippedResult('quality.prettier', 'Prettier is disabled'),
});

const typecheckGate = definePlatformGate({
  id: 'quality.typecheck',
  configKey: 'typeCheck',
  featureName: 'typeCheck',
  featureOrder: 130,
  doctorOrder: 40,
  environments: ['manual', 'pre-push', 'ci-full'],
  defaultTimeoutMs: DEFAULT_TYPE_CHECK_CONFIG.timeoutMs,
  manualCommand: 'typecheck',
  manualOrder: 50,
  packageScript: 'guard:typecheck',
  requiredScripts: ['config:typeCheck.script'],
  inspectSetup: setup.typecheck,
  plan: ({ config }) => ({ enabled: config.typeCheck.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runTypeCheckGate({ root, config: config.typeCheck })
    : skippedResult('quality.typecheck', 'Type check is disabled'),
});

const unitTestGate = definePlatformGate({
  id: 'quality.unit-test',
  configKey: 'unitTest',
  featureName: 'unitTest',
  featureOrder: 140,
  doctorOrder: 50,
  environments: ['manual', 'pre-push', 'ci-policy', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_UNIT_TEST_CONFIG.timeoutMs,
  manualCommand: 'unit-test',
  manualOrder: 60,
  packageScript: 'guard:unit-test',
  requiredTools: ['vitest'],
  requiredScripts: ['config:unitTest.script'],
  artifactTypes: ['coverage-report'],
  inspectSetup: setup.unitTest,
  plan: ({ config, step }) => ({
    enabled: config.unitTest.enabled,
    policyOnly: step?.id === 'quality.unit-test-policy',
  }),
  run: ({ root, config, changes, plan }) => {
    if (!plan.enabled) return skippedResult('quality.unit-test', 'Unit tests are disabled');
    if (!plan.policyOnly) return runUnitTestGate({ root, config: config.unitTest, changes });
    const policy = inspectUnitTestPolicy({ root, changes, config: config.unitTest });
    const violations = policy.missingTests.length + policy.bypasses.length + policy.componentInteractions.length;
    return violations === 0
      ? createGateResult({ gateId: 'quality.unit-test', status: 'passed', summary: 'Unit test policy passed' })
      : createGateResult({
          gateId: 'quality.unit-test',
          status: 'violation',
          summary: `Unit test policy found ${violations} violation(s)`,
          findings: unitTestPolicyFindings(policy),
        });
  },
});

const accessibilityGate = definePlatformGate({
  id: 'quality.accessibility-test',
  configKey: 'accessibilityTest',
  featureName: 'accessibilityTest',
  featureOrder: 100,
  doctorOrder: 60,
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_ACCESSIBILITY_TEST_CONFIG.timeoutMs,
  manualCommand: 'accessibility-test',
  manualOrder: 120,
  packageScript: 'guard:accessibility-test',
  requiredScripts: ['config:accessibilityTest.script'],
  inspectSetup: setup.accessibility,
  plan: ({ config }) => ({ enabled: config.accessibilityTest.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runAccessibilityTestGate({ root, config: config.accessibilityTest })
    : skippedResult('quality.accessibility-test', 'Accessibility tests are disabled'),
});

const architectureGate = definePlatformGate({
  id: 'quality.architecture',
  configKey: 'architecture',
  featureName: 'architecture',
  featureOrder: 90,
  doctorOrder: 20,
  environments: ['manual', 'pre-push', 'ci-full'],
  defaultTimeoutMs: DEFAULT_ARCHITECTURE_CONFIG.timeoutMs,
  manualCommand: 'architecture',
  manualOrder: 40,
  packageScript: 'guard:architecture',
  requiredTools: ['dependency-cruiser'],
  inspectSetup: setup.architecture,
  plan: ({ config }) => ({ enabled: config.architecture.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runArchitectureGate({ root, config: config.architecture })
    : skippedResult('quality.architecture', 'Architecture gate is disabled'),
});

const buildGate = definePlatformGate({
  id: 'quality.build',
  configKey: 'build',
  featureName: 'build',
  featureOrder: 110,
  doctorOrder: 10,
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'],
  defaultTimeoutMs: DEFAULT_BUILD_CONFIG.timeoutMs,
  manualCommand: 'build',
  manualOrder: 30,
  packageScript: 'guard:build',
  requiredScripts: ['config:build.script'],
  artifactTypes: ['build-output'],
  inspectSetup: setup.build,
  plan: ({ config }) => ({ enabled: config.build.enabled }),
  run: ({ root, config, plan }) => plan.enabled
    ? runBuildGate({ root, config: config.build })
    : skippedResult('quality.build', 'Build is disabled'),
});

const lighthouseGate = definePlatformGate({
  id: 'quality.lighthouse',
  configKey: 'lighthouse',
  featureName: 'lighthouse',
  featureOrder: 120,
  doctorOrder: 30,
  environments: ['manual', 'pre-push', 'release-ready'],
  defaultTimeoutMs: DEFAULT_LIGHTHOUSE_CONFIG.timeoutMs,
  manualCommand: 'lighthouse',
  manualOptions: ['--skip-build'],
  manualOrder: 160,
  packageScript: 'guard:lighthouse',
  requiredTools: ['@lhci/cli'],
  artifactTypes: ['lighthouse-report'],
  inspectSetup: setup.lighthouse,
  plan: ({ config, environment, argumentsList = [] }) => ({
    enabled: environment === 'manual' || config.lighthouse.enabled,
    skipBuild: argumentsList.includes('--skip-build')
      || (config.build.enabled && config.lighthouse.buildScript === config.build.script),
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runVueLighthouse({ root, config: config.lighthouse, skipBuild: plan.skipBuild })
    : skippedResult('quality.lighthouse', 'Lighthouse is disabled'),
});

function styleProjectGate({ id, configKey, featureName, featureOrder, command, manualOrder, run }) {
  return definePlatformGate({
    id,
    configKey,
    featureName,
    featureOrder,
    environments: ['manual'],
    manualCommand: command,
    manualOrder,
    packageScript: `guard:${command}`,
    requiredTools: ['stylelint'],
    plan: ({ files }) => ({ files: files.filter((file) => STYLE_FILE.test(typeof file === 'string' ? file : file.relative)) }),
    run,
  });
}

const styleComplexityGate = styleProjectGate({
  id: 'quality.style-complexity',
  configKey: 'preCommit.stylelint.complexity',
  featureName: 'styleComplexity',
  featureOrder: 60,
  command: 'style-complexity',
  manualOrder: 130,
  run: ({ root, config, plan }) => runStyleComplexityProject({
    root,
    files: plan.files,
    config: { ...config.preCommit.stylelint.complexity, enabled: true },
    exceptions: config.exceptions,
  }),
});

const styleGovernanceGate = styleProjectGate({
  id: 'quality.style-governance',
  configKey: 'preCommit.stylelint.governance',
  featureName: 'styleGovernance',
  featureOrder: 70,
  command: 'style-governance',
  manualOrder: 140,
  run: ({ root, config, plan }) => runStyleGovernanceProject({
    root,
    files: plan.files,
    config: { ...config.preCommit.stylelint.governance, enabled: true },
    exceptions: config.exceptions,
  }),
});

export const platformCapabilities = Object.freeze([
  stylelintGate,
  eslintGate,
  prettierGate,
  typecheckGate,
  unitTestGate,
  accessibilityGate,
  architectureGate,
  buildGate,
  lighthouseGate,
  styleComplexityGate,
  styleGovernanceGate,
]);
