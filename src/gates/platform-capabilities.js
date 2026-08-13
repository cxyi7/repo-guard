import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  isAccessibilityTestPolicyCurrent,
} from '../accessibility-test-policy.js';
import { validateAccessibilityTestSetup } from '../accessibility-test-runner.js';
import {
  ARCHITECTURE_POLICY_FILE,
  isArchitecturePolicyCurrent,
} from '../architecture-policy.js';
import { validateArchitectureSetup } from '../architecture-runner.js';
import { validateBuildSetup } from '../build-runner.js';
import { defineGate } from '../core/capability/gate-definition.js';
import { isStructuredCoverage } from '../coverage-runner.js';
import {
  resolveProjectEslintMetadata,
  resolveRepoGuardEslintPreset,
} from '../eslint-runner.js';
import { validateVueLighthouseSetup } from '../lighthouse-project.js';
import {
  resolveProjectPrettierConfigFile,
  resolveProjectPrettierMetadata,
} from '../prettier-runner.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from '../stylelint-project.js';
import {
  isUnitTestPolicyCurrent,
  UNIT_TEST_POLICY_FILE,
} from '../unit-test-policy.js';
import { validateUnitTestSetup } from '../unit-test-runner.js';
import { validateTypeCheckSetup } from '../typecheck-runner.js';

const CONFIG_VERSION = [1];

function placeholderRun() {
  throw new Error('Legacy capability must be invoked through its orchestration adapter');
}

function legacySetupInspection() {
  return null;
}

function ready(summary) {
  return { status: 'ready', summary };
}

function policyFileIsCurrent(root, file, predicate, config) {
  const target = path.join(root, file);
  return existsSync(target) && predicate(readFileSync(target, 'utf8'), config);
}

const setup = {
  build({ root, config }) {
    if (!config.build.enabled) return ready('Build pre-push gate is disabled');
    validateBuildSetup(root, config.build);
    return ready(`Build pre-push gate (script=${config.build.script}, timeoutMs=${config.build.timeoutMs})`);
  },
  architecture({ root, config }) {
    if (!config.architecture.enabled) return ready('Architecture dependency pre-push gate is disabled');
    const resolved = validateArchitectureSetup(root, config.architecture);
    if (!policyFileIsCurrent(root, ARCHITECTURE_POLICY_FILE, isArchitecturePolicyCurrent, config.architecture)) throw new Error(`${ARCHITECTURE_POLICY_FILE} is missing the repo-guard architecture policy; run repo-guard doctor --fix`);
    return ready(`Architecture dependency gate (dependency-cruiser ${resolved.dependencyCruiser.version}, ${config.architecture.rules.length} rules, sources=${config.architecture.sourcePaths.join(',')})`);
  },
  lighthouse({ root, config }) {
    if (!config.lighthouse.enabled) return ready('Lighthouse Vue pre-push gate is disabled');
    const resolved = validateVueLighthouseSetup(root, config.lighthouse);
    return ready(`Lighthouse CI ${resolved.lighthouse.version} Vue pre-push gate (config=${resolved.configFile}, build=${config.lighthouse.buildScript || 'skipped'})`);
  },
  typecheck({ root, config }) {
    if (!config.typeCheck.enabled) return ready('TypeScript pre-push gate is disabled');
    validateTypeCheckSetup(root, config.typeCheck);
    return ready(`TypeScript pre-push gate (script=${config.typeCheck.script}, timeoutMs=${config.typeCheck.timeoutMs})`);
  },
  unitTest({ root, config }) {
    if (!config.unitTest.enabled) return ready('Unit test pre-push gate is disabled');
    const resolved = validateUnitTestSetup(root, config.unitTest);
    if (!policyFileIsCurrent(root, UNIT_TEST_POLICY_FILE, isUnitTestPolicyCurrent, config.unitTest)) throw new Error(`${UNIT_TEST_POLICY_FILE} is missing the repo-guard unit test policy; run repo-guard doctor --fix`);
    const coverage = isStructuredCoverage(config.unitTest.coverage)
      ? `global=${config.unitTest.coverage.thresholds.lines}%/changed=${config.unitTest.coverage.thresholds.changedLines}%`
      : typeof config.unitTest.coverage === 'boolean' ? config.unitTest.coverage : 'disabled';
    return ready(`Vitest ${resolved.vitest.version} pre-push gate (script=${config.unitTest.script}, requireTests=${config.unitTest.requireTests}, componentInteraction=${resolved.vueTestUtils ? `Vue Test Utils ${resolved.vueTestUtils.version}` : 'disabled'}, coverage=${coverage}, mappings=${config.unitTest.mappings.length})`);
  },
  accessibility({ root, config }) {
    if (!config.accessibilityTest.enabled) return ready('axe accessibility test pre-push gate is disabled');
    const resolved = validateAccessibilityTestSetup(root, config.accessibilityTest);
    if (!policyFileIsCurrent(root, ACCESSIBILITY_TEST_POLICY_FILE, isAccessibilityTestPolicyCurrent, config.accessibilityTest)) throw new Error(`${ACCESSIBILITY_TEST_POLICY_FILE} is missing the repo-guard accessibility test policy; run repo-guard doctor --fix`);
    return ready(`axe accessibility test pre-push gate (script=${config.accessibilityTest.script}, files=${resolved.files.length}, integrations=${resolved.integrations.map(({ name, version }) => `${name}@${version}`).join(',')})`);
  },
  async eslint({ root, config }) {
    const configured = config.preCommit.eslint;
    if (!configured.enabled) return ready('ESLint staged gate is disabled');
    const eslint = resolveProjectEslintMetadata(root);
    const preset = configured.preset ? await resolveRepoGuardEslintPreset(root, eslint.version) : null;
    return ready(`ESLint ${eslint.version} staged gate (${configured.pattern}, fix=${configured.fix}, preset=${preset ? `enabled: ${preset.integrations.join(', ')}` : 'disabled'})`);
  },
  stylelint({ root, config }) {
    const configured = config.preCommit.stylelint;
    if (!configured.enabled) return ready('Stylelint staged gate is disabled');
    const stylelint = resolveProjectStylelintMetadata(root);
    const configFile = findProjectStylelintConfig(root);
    if (configured.requireConfig && !configFile) throw new Error('Stylelint staged gate requires a project Stylelint configuration file');
    return ready(`Stylelint ${stylelint.version} staged gate (${configured.pattern}, fix=${configured.fix}, config=${configFile || 'project config optional'}, complexity=${configured.complexity.enabled ? `compound<=${configured.complexity.maxCompoundSelectors}, nesting<=${configured.complexity.maxNestingDepth}` : 'disabled'}, governance=${configured.governance.enabled ? `specificity<=${configured.governance.maxSpecificity}, ids<=${configured.governance.maxIdSelectors}, important=${configured.governance.disallowImportant ? 'blocked' : 'allowed'}, global-patterns=${configured.governance.allowedGlobalStylePatterns.length}` : 'disabled'})`);
  },
  async prettier({ root, config }) {
    const configured = config.preCommit.prettier;
    if (!configured.enabled) return ready('Prettier staged gate is disabled');
    const prettier = resolveProjectPrettierMetadata(root);
    let description = 'project config optional';
    if (configured.requireConfig) {
      const file = await resolveProjectPrettierConfigFile(root);
      if (!file) throw new Error('Prettier staged gate requires a project Prettier configuration file');
      description = path.relative(root, file);
    }
    return ready(`Prettier ${prettier.version} staged gate (${configured.pattern}, fix=${configured.fix}, config=${description})`);
  },
};

function defineLegacyCapability({
  id,
  configKey = null,
  featureName = null,
  featureOrder = null,
  environments,
  mutation = 'read-only',
  manualCommand = null,
  manualOptions = [],
  manualOrder = null,
  doctorOrder = null,
  packageScript = null,
  requires = [],
  before = [],
  after = [],
  inspectSetup = legacySetupInspection,
}) {
  return defineGate({
    id,
    configKey,
    featureName,
    featureOrder,
    configVersions: CONFIG_VERSION,
    environments,
    mutation,
    defaultTimeoutMs: 120000,
    requires,
    before,
    after,
    inspectSetup,
    plan: placeholderRun,
    run: placeholderRun,
    manualCommand,
    manualOptions,
    manualOrder,
    doctorOrder,
    packageScript,
  });
}

export const platformCapabilities = Object.freeze([
  defineLegacyCapability({ id: 'quality.stylelint', configKey: 'preCommit.stylelint', featureName: 'stylelint', featureOrder: 30, doctorOrder: 160, environments: ['pre-commit', 'ci-full'], mutation: 'working-tree-fix', before: ['quality.eslint'], inspectSetup: setup.stylelint }),
  defineLegacyCapability({ id: 'quality.eslint', configKey: 'preCommit.eslint', featureName: 'eslint', featureOrder: 10, doctorOrder: 130, environments: ['pre-commit', 'ci-full'], mutation: 'working-tree-fix', before: ['quality.prettier'], inspectSetup: setup.eslint }),
  defineLegacyCapability({ id: 'quality.prettier', configKey: 'preCommit.prettier', featureName: 'prettier', featureOrder: 20, doctorOrder: 170, environments: ['pre-commit', 'ci-full'], mutation: 'working-tree-fix', inspectSetup: setup.prettier }),
  defineLegacyCapability({ id: 'security.vue-unsafe-html', doctorOrder: 80, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full'], manualCommand: 'unsafe-html', manualOrder: 80, packageScript: 'guard:unsafe-html', inspectSetup: () => ready('Vue v-html staged gate (hard requirement, rule=vue/no-v-html)') }),
  defineLegacyCapability({ id: 'security.vue-target-blank', doctorOrder: 90, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full'], manualCommand: 'target-blank', manualOrder: 90, packageScript: 'guard:target-blank', inspectSetup: () => ready('Vue target=_blank staged gate (hard requirement, rel=noopener+noreferrer, rule=vue/target-blank-security)') }),
  defineLegacyCapability({ id: 'accessibility.vue-form-label', doctorOrder: 100, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full'], manualCommand: 'form-labels', manualOrder: 100, packageScript: 'guard:form-labels', inspectSetup: () => ready('Vue form control label staged gate (hard requirement, rule=vue/form-control-label)') }),
  defineLegacyCapability({ id: 'accessibility.vue-image-alt', doctorOrder: 110, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full'], manualCommand: 'image-alt', manualOrder: 110, packageScript: 'guard:image-alt', inspectSetup: () => ready('Vue image alt staged gate (hard requirement, rule=vue/img-alt)') }),
  defineLegacyCapability({ id: 'repository.maximum-file-lines', configKey: 'preCommit.maxFileLines', featureName: 'maxFileLines', featureOrder: 50, doctorOrder: 140, environments: ['pre-commit', 'ci-policy', 'ci-full'], inspectSetup: ({ config }) => ready(config.preCommit.maxFileLines.enabled ? `Maximum file lines staged gate (mode=${config.preCommit.maxFileLines.mode}, warnAt=${config.preCommit.maxFileLines.warnAt}, ${config.preCommit.maxFileLines.rules.map(({ pattern, maxLines }) => `${pattern}<=${maxLines}`).join(', ')})` : 'Maximum file lines staged gate is disabled') }),
  defineLegacyCapability({ id: 'repository.file-placement', configKey: 'preCommit.filePlacement', featureName: 'filePlacement', featureOrder: 40, doctorOrder: 150, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full'], manualCommand: 'file-placement', manualOrder: 150, packageScript: 'guard:file-placement', inspectSetup: ({ config }) => ready(config.preCommit.filePlacement.enabled ? `File placement staged gate (mode=${config.preCommit.filePlacement.mode}, ${config.preCommit.filePlacement.rules.length} rules)` : 'File placement staged gate is disabled') }),
  defineLegacyCapability({ id: 'dependencies.policy', configKey: 'dependencyPolicy', featureName: 'dependencies', featureOrder: 80, doctorOrder: 120, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full'], manualCommand: 'dependencies', manualOrder: 20, packageScript: 'guard:dependencies', inspectSetup: ({ config }) => ready(config.dependencyPolicy.enabled ? `Dependency policy (exact=${config.dependencyPolicy.requireExactVersions}, lockfile=${config.dependencyPolicy.requireLockfile}, protocols=${config.dependencyPolicy.allowedProtocols.join(',') || 'none'}, banned=${config.dependencyPolicy.bannedPackages.length})` : 'Dependency policy staged gate is disabled') }),
  defineLegacyCapability({ id: 'repository.protected-files', environments: ['pre-commit', 'ci-policy', 'ci-full'], mutation: 'external-write' }),
  defineLegacyCapability({ id: 'repository.structured-exceptions', configKey: 'exceptions', environments: ['manual', 'ci-policy', 'ci-full'], manualCommand: 'exceptions', manualOrder: 10, packageScript: 'guard:exceptions' }),
  defineLegacyCapability({ id: 'quality.typecheck', configKey: 'typeCheck', featureName: 'typeCheck', featureOrder: 130, doctorOrder: 40, environments: ['manual', 'pre-push', 'ci-full'], manualCommand: 'typecheck', manualOrder: 50, packageScript: 'guard:typecheck', inspectSetup: setup.typecheck }),
  defineLegacyCapability({ id: 'quality.unit-test', configKey: 'unitTest', featureName: 'unitTest', featureOrder: 140, doctorOrder: 50, environments: ['manual', 'pre-push', 'ci-policy', 'ci-full'], manualCommand: 'unit-test', manualOrder: 60, packageScript: 'guard:unit-test', inspectSetup: setup.unitTest }),
  defineLegacyCapability({ id: 'quality.accessibility-test', configKey: 'accessibilityTest', featureName: 'accessibilityTest', featureOrder: 100, doctorOrder: 60, environments: ['manual', 'pre-push', 'ci-full'], manualCommand: 'accessibility-test', manualOrder: 120, packageScript: 'guard:accessibility-test', inspectSetup: setup.accessibility }),
  defineLegacyCapability({ id: 'quality.architecture', configKey: 'architecture', featureName: 'architecture', featureOrder: 90, doctorOrder: 20, environments: ['manual', 'pre-push', 'ci-full'], manualCommand: 'architecture', manualOrder: 40, packageScript: 'guard:architecture', inspectSetup: setup.architecture }),
  defineLegacyCapability({ id: 'quality.build', configKey: 'build', featureName: 'build', featureOrder: 110, doctorOrder: 10, environments: ['manual', 'pre-push', 'ci-full'], manualCommand: 'build', manualOrder: 30, packageScript: 'guard:build', inspectSetup: setup.build }),
  defineLegacyCapability({ id: 'quality.lighthouse', configKey: 'lighthouse', featureName: 'lighthouse', featureOrder: 120, doctorOrder: 30, environments: ['manual', 'pre-push'], manualCommand: 'lighthouse', manualOptions: ['--skip-build'], manualOrder: 160, packageScript: 'guard:lighthouse', inspectSetup: setup.lighthouse }),
  defineLegacyCapability({ id: 'quality.style-complexity', configKey: 'preCommit.stylelint.complexity', featureName: 'styleComplexity', featureOrder: 60, environments: ['manual'], manualCommand: 'style-complexity', manualOrder: 130, packageScript: 'guard:style-complexity' }),
  defineLegacyCapability({ id: 'quality.style-governance', configKey: 'preCommit.stylelint.governance', featureName: 'styleGovernance', featureOrder: 70, environments: ['manual'], manualCommand: 'style-governance', manualOrder: 140, packageScript: 'guard:style-governance' }),
]);
