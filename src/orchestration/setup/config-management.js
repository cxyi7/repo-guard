import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { gateRegistry } from '../../gates/registry.js';
import { assertExceptionLifecycleCurrent } from '../../config/exception-lifecycle.js';
import { validateConfig } from '../../config/configuration-validation.js';
import {
  DEFAULT_CI_CONFIG,
  DEFAULT_CI_PIPELINE_CONFIG,
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_CODE_PLACEMENT_CONFIG,
  DEFAULT_COMMIT_MESSAGE_CONFIG,
  DEFAULT_COMPONENT_INTERACTION_CONFIG,
  DEFAULT_DEPENDENCY_POLICY_CONFIG,
  DEFAULT_DEAD_CODE_CONFIG,
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_EXCEPTIONS_CONFIG,
  DEFAULT_FILE_HEADER_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_FUNCTION_DOC_CONFIG,
  DEFAULT_IMAGE_ASSETS_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_MUTATION_TEST_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_PATH_NAMING_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
  DEFAULT_STYLE_COMPLEXITY_CONFIG,
  DEFAULT_STYLE_GOVERNANCE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../../config/defaults.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';

export const CONFIG_SCHEMA_PATH = './node_modules/@cxyi7/repo-guard/config.schema.json';
export const QUALITY_GATES = Object.freeze(
  gateRegistry.configurable
    .filter(({ id }) => ['quality.eslint', 'quality.prettier', 'quality.stylelint'].includes(id))
    .map(({ featureName }) => featureName),
);
const GATE_FEATURES = gateRegistry.configurable.map(({ featureName }) => featureName);
export const CONFIGURABLE_FEATURES = Object.freeze([
  ...GATE_FEATURES,
  'componentInteraction',
  'coverage',
  'fileHeader',
  'functionDocs',
  'notification',
  'ci',
]);

function cloneExceptionsConfig(value = {}) {
  return {
    ...DEFAULT_EXCEPTIONS_CONFIG,
    ...value,
    entries: (value.entries ?? DEFAULT_EXCEPTIONS_CONFIG.entries).map((entry) => ({ ...entry })),
  };
}

function cloneCiPipelineConfig(value = {}) {
  return {
    ...DEFAULT_CI_PIPELINE_CONFIG,
    ...value,
    testBranches: [...(value.testBranches ?? DEFAULT_CI_PIPELINE_CONFIG.testBranches)],
    productionBranches: [
      ...(value.productionBranches ?? DEFAULT_CI_PIPELINE_CONFIG.productionBranches),
    ],
    runnerTags: [...(value.runnerTags ?? DEFAULT_CI_PIPELINE_CONFIG.runnerTags)],
  };
}

function cloneDependencyPolicyConfig(value = {}) {
  return {
    ...DEFAULT_DEPENDENCY_POLICY_CONFIG,
    ...value,
    allowedProtocols: [
      ...(value.allowedProtocols ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.allowedProtocols),
    ],
    bannedPackages: (
      value.bannedPackages ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.bannedPackages
    ).map((item) => ({ ...item })),
  };
}

function cloneCommitMessageConfig(value = {}) {
  return {
    ...DEFAULT_COMMIT_MESSAGE_CONFIG,
    ...value,
    types: [...(value.types ?? DEFAULT_COMMIT_MESSAGE_CONFIG.types)],
    allowedScopes: [...(value.allowedScopes ?? DEFAULT_COMMIT_MESSAGE_CONFIG.allowedScopes)],
    breakingChange: {
      ...DEFAULT_COMMIT_MESSAGE_CONFIG.breakingChange,
      ...(value.breakingChange ?? {}),
    },
    merge: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.merge, ...(value.merge ?? {}) },
    revert: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.revert, ...(value.revert ?? {}) },
    fixup: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.fixup, ...(value.fixup ?? {}) },
  };
}

function cloneDeadCodeConfig(value = {}) {
  return {
    ...DEFAULT_DEAD_CODE_CONFIG,
    ...value,
    issueTypes: [...(value.issueTypes ?? DEFAULT_DEAD_CODE_CONFIG.issueTypes)],
  };
}

function cloneArchitectureConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_ARCHITECTURE_CONFIG.rules;
  return {
    ...DEFAULT_ARCHITECTURE_CONFIG,
    ...value,
    sourcePaths: [...(value.sourcePaths ?? DEFAULT_ARCHITECTURE_CONFIG.sourcePaths)],
    rules: rules.map((rule) => ({
      ...rule,
      from: structuredClone(rule.from),
      to: structuredClone(rule.to),
    })),
  };
}

function cloneCodePlacementConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_CODE_PLACEMENT_CONFIG.rules;
  return {
    ...DEFAULT_CODE_PLACEMENT_CONFIG,
    ...value,
    rules: rules.map((rule) => ({
      ...rule,
      allowedFiles: [...rule.allowedFiles],
      scanPatterns: [...rule.scanPatterns],
    })),
  };
}

function cloneFilePlacementConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_FILE_PLACEMENT_CONFIG.rules;
  return {
    ...DEFAULT_FILE_PLACEMENT_CONFIG,
    ...value,
    rules: rules.map((rule) => ({
      ...rule,
      patterns: [...rule.patterns],
      allowedPatterns: [...rule.allowedPatterns],
      exceptions: [...(rule.exceptions ?? [])],
    })),
  };
}

function cloneFileHeaderConfig(value = {}) {
  return {
    ...DEFAULT_FILE_HEADER_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_FILE_HEADER_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_FILE_HEADER_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_FILE_HEADER_CONFIG.extensions)],
  };
}

function cloneFunctionDocConfig(value = {}) {
  return {
    ...DEFAULT_FUNCTION_DOC_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_FUNCTION_DOC_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_FUNCTION_DOC_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_FUNCTION_DOC_CONFIG.extensions)],
  };
}

function cloneAsyncResourceCleanupConfig(value = {}) {
  return {
    ...DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.extensions)],
    requestFunctions: [
      ...(value.requestFunctions ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.requestFunctions),
    ],
  };
}

function clonePathNamingConfig(value = {}) {
  return {
    ...DEFAULT_PATH_NAMING_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_PATH_NAMING_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_PATH_NAMING_CONFIG.exclude)],
  };
}

function cloneImageAssetsConfig(value = {}) {
  const naming = value.naming ?? DEFAULT_IMAGE_ASSETS_CONFIG.naming;
  const duplicates = value.duplicates ?? DEFAULT_IMAGE_ASSETS_CONFIG.duplicates;
  const compression = value.compression ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression;
  const raster = compression.raster ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.raster;
  const svg = compression.svg ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.svg;
  const conversion = compression.conversion
    ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion;
  const unused = value.unused ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused;
  return {
    ...DEFAULT_IMAGE_ASSETS_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_IMAGE_ASSETS_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_IMAGE_ASSETS_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_IMAGE_ASSETS_CONFIG.extensions)],
    naming: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.naming,
      ...naming,
      densitySuffixes: [
        ...(naming.densitySuffixes ?? DEFAULT_IMAGE_ASSETS_CONFIG.naming.densitySuffixes),
      ],
    },
    duplicates: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.duplicates,
      ...duplicates,
      canonicalRoots: [
        ...(duplicates.canonicalRoots
          ?? DEFAULT_IMAGE_ASSETS_CONFIG.duplicates.canonicalRoots),
      ],
    },
    compression: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.compression,
      ...compression,
      raster: { ...DEFAULT_IMAGE_ASSETS_CONFIG.compression.raster, ...raster },
      svg: { ...DEFAULT_IMAGE_ASSETS_CONFIG.compression.svg, ...svg },
      conversion: {
        ...DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion,
        ...conversion,
        sourceFormats: [
          ...(conversion.sourceFormats
            ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion.sourceFormats),
        ],
      },
    },
    unused: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.unused,
      ...unused,
      sourceInclude: [...(unused.sourceInclude ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.sourceInclude)],
      sourceExclude: [...(unused.sourceExclude ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.sourceExclude)],
      sourceExtensions: [...(unused.sourceExtensions ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.sourceExtensions)],
      aliases: (unused.aliases ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.aliases).map((entry) => ({ ...entry })),
      publicRoots: (unused.publicRoots ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.publicRoots).map((entry) => ({ ...entry })),
      dynamicReferences: (unused.dynamicReferences ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.dynamicReferences).map((entry) => ({
        ...entry,
        sourcePatterns: [...entry.sourcePatterns],
        assetPatterns: [...entry.assetPatterns],
      })),
      limits: {
        ...DEFAULT_IMAGE_ASSETS_CONFIG.unused.limits,
        ...(unused.limits ?? {}),
      },
    },
    limits: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.limits,
      ...(value.limits ?? {}),
    },
  };
}

function cloneUnitTestConfig(value = {}) {
  const mappings = value.mappings ?? DEFAULT_UNIT_TEST_CONFIG.mappings;
  const coverage = value.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage;
  return {
    ...DEFAULT_UNIT_TEST_CONFIG,
    ...value,
    coverage: {
      ...DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
      ...coverage,
      thresholds: {
        ...DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds,
        ...(coverage.thresholds ?? {}),
      },
    },
    componentInteraction: {
      ...DEFAULT_COMPONENT_INTERACTION_CONFIG,
      ...(value.componentInteraction ?? {}),
      componentPatterns: [
        ...(value.componentInteraction?.componentPatterns
          ?? DEFAULT_COMPONENT_INTERACTION_CONFIG.componentPatterns),
      ],
    },
    sourcePatterns: [...(value.sourcePatterns ?? DEFAULT_UNIT_TEST_CONFIG.sourcePatterns)],
    testPatterns: [...(value.testPatterns ?? DEFAULT_UNIT_TEST_CONFIG.testPatterns)],
    mappings: mappings.map((mapping) => ({
      ...mapping,
      testTemplates: [...mapping.testTemplates],
    })),
    exclusions: [...(value.exclusions ?? DEFAULT_UNIT_TEST_CONFIG.exclusions)],
  };
}

function cloneMutationTestConfig(value = {}) {
  return {
    ...DEFAULT_MUTATION_TEST_CONFIG,
    ...value,
    guardedBuilds: (value.guardedBuilds ?? DEFAULT_MUTATION_TEST_CONFIG.guardedBuilds)
      .map((entry) => ({ ...entry })),
  };
}

function cloneStylelintConfig(value = {}) {
  return {
    ...DEFAULT_STYLELINT_CONFIG,
    ...value,
    complexity: {
      ...DEFAULT_STYLE_COMPLEXITY_CONFIG,
      ...(value.complexity ?? {}),
    },
    governance: {
      ...DEFAULT_STYLE_GOVERNANCE_CONFIG,
      ...(value.governance ?? {}),
      allowedGlobalStylePatterns: [
        ...(value.governance?.allowedGlobalStylePatterns
          ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.allowedGlobalStylePatterns),
      ],
    },
  };
}

export function createStarterConfig({
  accessibilityTestEnabled = false,
  architectureEnabled = false,
  buildEnabled = false,
  stylelintEnabled = false,
  typeCheckEnabled = false,
  unitTestEnabled = false,
} = {}) {
  return {
    $schema: CONFIG_SCHEMA_PATH,
    version: 1,
    notification: { ...DEFAULT_NOTIFICATION_CONFIG },
    ci: {
      ...DEFAULT_CI_CONFIG,
      protectedFiles: { ...DEFAULT_CI_CONFIG.protectedFiles },
      gatePolicy: {
        ...DEFAULT_CI_CONFIG.gatePolicy,
        gates: { ...DEFAULT_CI_CONFIG.gatePolicy.gates },
      },
      pipeline: cloneCiPipelineConfig(),
    },
    externalGates: [],
    codePlacement: cloneCodePlacementConfig(),
    exceptions: cloneExceptionsConfig(),
    dependencyPolicy: cloneDependencyPolicyConfig({ enabled: true }),
    commitMessage: cloneCommitMessageConfig(),
    deadCode: cloneDeadCodeConfig(),
    imageAssets: cloneImageAssetsConfig(),
    architecture: cloneArchitectureConfig({ enabled: architectureEnabled }),
    accessibilityTest: {
      ...DEFAULT_ACCESSIBILITY_TEST_CONFIG,
      enabled: accessibilityTestEnabled,
      testPatterns: [...DEFAULT_ACCESSIBILITY_TEST_CONFIG.testPatterns],
    },
    build: {
      ...DEFAULT_BUILD_CONFIG,
      enabled: buildEnabled,
    },
    lighthouse: { ...DEFAULT_LIGHTHOUSE_CONFIG },
    typeCheck: {
      ...DEFAULT_TYPE_CHECK_CONFIG,
      enabled: typeCheckEnabled,
    },
    unitTest: cloneUnitTestConfig({ enabled: unitTestEnabled }),
    mutationTest: cloneMutationTestConfig(),
    preCommit: {
      asyncResourceCleanup: cloneAsyncResourceCleanupConfig(),
      pathNaming: clonePathNamingConfig(),
      fileHeader: cloneFileHeaderConfig(),
      functionDocs: cloneFunctionDocConfig(),
      filePlacement: cloneFilePlacementConfig(),
      maxFileLines: {
        ...DEFAULT_MAX_FILE_LINES_CONFIG,
        enabled: true,
        rules: DEFAULT_MAX_FILE_LINES_CONFIG.rules.map((rule) => ({ ...rule })),
        exclusions: [...DEFAULT_MAX_FILE_LINES_CONFIG.exclusions],
      },
      stylelint: cloneStylelintConfig({
        enabled: stylelintEnabled,
        complexity: { enabled: stylelintEnabled },
        governance: { enabled: stylelintEnabled },
      }),
      prettier: { ...DEFAULT_PRETTIER_CONFIG, enabled: true },
      eslint: { ...DEFAULT_ESLINT_CONFIG, enabled: true, preset: true },
    },
    rules: [
      { pattern: 'package.json', category: '依赖与包元数据', level: 'notify' },
      { pattern: '**/package.json', category: '依赖与包元数据', level: 'notify' },
      { pattern: 'package-lock.json', category: '依赖锁文件', level: 'notify' },
      { pattern: '.env*', category: '环境配置', level: 'notify' },
      { pattern: 'src/main.*', category: '应用入口', level: 'notify' },
      { pattern: 'src/App.vue', category: '应用入口', level: 'notify' },
      { pattern: 'src/components/**', category: '共享组件', level: 'notify' },
      { pattern: '.githooks/**', category: '仓库守卫基础设施', level: 'notify' },
      { pattern: CONFIG_FILE, category: '仓库守卫基础设施', level: 'notify' },
      { pattern: '.repo-guard/knip-baseline.json', category: '无效代码历史债务基线', level: 'notify' },
      {
        pattern: '{knip,.knip,knip.config}.{json,jsonc,js,ts,mjs,cjs}',
        category: '无效代码分析配置',
        level: 'notify',
      },
    ],
    exclusions: [],
  };
}

function configPath(root) {
  return path.join(root, CONFIG_FILE);
}

function readProjectConfig(root) {
  try {
    return JSON.parse(readFileSync(configPath(root), 'utf8'));
  } catch (error) {
    throw configurationError('config/management-invalid', `无法读取 ${CONFIG_FILE}: ${error.message}`);
  }
}

function writeProjectConfig(root, value) {
  writeFileSync(configPath(root), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function ensureProjectConfig(root, options) {
  if (existsSync(configPath(root))) {
    return { created: false };
  }
  writeProjectConfig(root, createStarterConfig(options));
  return { created: true };
}

export function migrateProjectConfig(root, {
  allowExpiredExceptions = false,
  now = new Date(),
} = {}) {
  const current = readProjectConfig(root);
  const prepared = { ...current, version: current.version ?? 1 };

  // Invalid values must fail before migration can rewrite the user's file.
  const currentConfig = validateConfig(prepared);
  if (!allowExpiredExceptions) {
    assertExceptionLifecycleCurrent(currentConfig.exceptions, { now });
  }

  const preCommit = prepared.preCommit ?? {};
  const next = {
    $schema: prepared.$schema ?? CONFIG_SCHEMA_PATH,
    ...prepared,
    notification: {
      ...DEFAULT_NOTIFICATION_CONFIG,
      ...(prepared.notification ?? {}),
    },
    ci: {
      ...DEFAULT_CI_CONFIG,
      ...(prepared.ci ?? {}),
      protectedFiles: {
        ...DEFAULT_CI_CONFIG.protectedFiles,
        ...(prepared.ci?.protectedFiles ?? {}),
      },
      gatePolicy: {
        ...DEFAULT_CI_CONFIG.gatePolicy,
        ...(prepared.ci?.gatePolicy ?? {}),
        gates: {
          ...DEFAULT_CI_CONFIG.gatePolicy.gates,
          ...(prepared.ci?.gatePolicy?.gates ?? {}),
        },
      },
      pipeline: cloneCiPipelineConfig(prepared.ci?.pipeline),
    },
    externalGates: prepared.externalGates ?? [],
    codePlacement: cloneCodePlacementConfig(prepared.codePlacement),
    exceptions: cloneExceptionsConfig(prepared.exceptions),
    dependencyPolicy: cloneDependencyPolicyConfig(prepared.dependencyPolicy),
    commitMessage: cloneCommitMessageConfig(prepared.commitMessage),
    deadCode: cloneDeadCodeConfig(prepared.deadCode),
    imageAssets: cloneImageAssetsConfig(prepared.imageAssets),
    architecture: cloneArchitectureConfig(prepared.architecture),
    accessibilityTest: {
      ...DEFAULT_ACCESSIBILITY_TEST_CONFIG,
      ...(prepared.accessibilityTest ?? {}),
      testPatterns: [
        ...(prepared.accessibilityTest?.testPatterns
          ?? DEFAULT_ACCESSIBILITY_TEST_CONFIG.testPatterns),
      ],
    },
    build: {
      ...DEFAULT_BUILD_CONFIG,
      ...(prepared.build ?? {}),
    },
    lighthouse: {
      ...DEFAULT_LIGHTHOUSE_CONFIG,
      ...(prepared.lighthouse ?? {}),
    },
    typeCheck: {
      ...DEFAULT_TYPE_CHECK_CONFIG,
      ...(prepared.typeCheck ?? {}),
    },
    unitTest: cloneUnitTestConfig(prepared.unitTest),
    mutationTest: cloneMutationTestConfig(prepared.mutationTest),
    preCommit: {
      ...preCommit,
      asyncResourceCleanup: cloneAsyncResourceCleanupConfig(preCommit.asyncResourceCleanup),
      pathNaming: clonePathNamingConfig(preCommit.pathNaming),
      fileHeader: cloneFileHeaderConfig(preCommit.fileHeader),
      functionDocs: cloneFunctionDocConfig(preCommit.functionDocs),
      filePlacement: cloneFilePlacementConfig(preCommit.filePlacement),
      maxFileLines: {
        ...DEFAULT_MAX_FILE_LINES_CONFIG,
        ...(preCommit.maxFileLines ?? {}),
      },
      stylelint: cloneStylelintConfig(preCommit.stylelint),
      prettier: {
        ...DEFAULT_PRETTIER_CONFIG,
        ...(preCommit.prettier ?? {}),
      },
      eslint: {
        ...DEFAULT_ESLINT_CONFIG,
        ...(preCommit.eslint ?? {}),
      },
    },
    exclusions: prepared.exclusions ?? [],
  };

  validateConfig(next);
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) {
    writeProjectConfig(root, next);
  }
  return { changed, config: next };
}

function featureConfig(config, feature) {
  if (feature === 'coverage') {
    return config.unitTest.coverage;
  }
  if (feature === 'componentInteraction') {
    return config.unitTest.componentInteraction;
  }
  if (feature === 'fileHeader') {
    return config.preCommit.fileHeader;
  }
  if (feature === 'functionDocs') {
    return config.preCommit.functionDocs;
  }
  const gate = gateRegistry.configurable.find(({ featureName }) => featureName === feature);
  if (gate) {
    return gate.configKey.split('.').reduce((current, key) => current[key], config);
  }
  if (feature === 'ci' || feature === 'notification') return config[feature];
  throw configurationError('config/management-invalid', `不支持的可配置功能： ${feature}`);
}

export function setFeaturesEnabled(root, requestedFeatures, enabled) {
  if (typeof enabled !== 'boolean') {
    throw configurationError('config/management-invalid', '功能状态必须是布尔值');
  }
  const uniqueFeatures = [...new Set(requestedFeatures)];
  if (uniqueFeatures.length === 0) {
    throw configurationError('config/management-invalid', `请至少选择一项功能： ${CONFIGURABLE_FEATURES.join(', ')}`);
  }

  const unsupported = uniqueFeatures.filter(
    (feature) => !CONFIGURABLE_FEATURES.includes(feature),
  );
  if (unsupported.length > 0) {
    throw configurationError('config/management-invalid', `不支持的功能： ${unsupported.join(', ')}`);
  }
  const requiredFeatures = [];
  if (enabled && uniqueFeatures.includes('coverage')) requiredFeatures.push('unitTest');
  if (enabled && uniqueFeatures.includes('componentInteraction')) requiredFeatures.push('unitTest');
  if (!enabled && uniqueFeatures.includes('unitTest')) requiredFeatures.push('componentInteraction');
  if (enabled && uniqueFeatures.includes('styleComplexity')) requiredFeatures.push('stylelint');
  if (enabled && uniqueFeatures.includes('styleGovernance')) requiredFeatures.push('stylelint');
  if (!enabled && uniqueFeatures.includes('stylelint')) {
    requiredFeatures.push('styleComplexity', 'styleGovernance');
  }
  if (enabled && uniqueFeatures.includes('unusedImageAssets')) requiredFeatures.push('imageAssets');
  if (!enabled && uniqueFeatures.includes('imageAssets')) requiredFeatures.push('unusedImageAssets');
  const effectiveFeatures = [...new Set([...requiredFeatures, ...uniqueFeatures])];

  const migration = migrateProjectConfig(root);
  const next = migration.config;
  const changed = [];
  const unchanged = [];

  for (const feature of effectiveFeatures) {
    const target = featureConfig(next, feature);
    if (target.enabled === enabled) {
      unchanged.push(feature);
    } else {
      target.enabled = enabled;
      changed.push(feature);
    }
  }

  validateConfig(next);
  if (changed.length > 0) {
    writeProjectConfig(root, next);
  }
  return {
    changed,
    migrated: migration.changed,
    targetEnabled: enabled,
    unchanged,
  };
}

export function enableQualityGates(root, requestedGates) {
  const unsupported = requestedGates.filter((gate) => !QUALITY_GATES.includes(gate));
  if (unsupported.length > 0) {
    throw configurationError('config/management-invalid', `不支持的质量门禁： ${unsupported.join(', ')}`);
  }
  const result = setFeaturesEnabled(root, requestedGates, true);
  return {
    alreadyEnabled: result.unchanged,
    enabled: result.changed,
    migrated: result.migrated,
  };
}

export function configureCi(root, { profile = 'policy' } = {}) {
  if (!['policy', 'full', 'release-ready'].includes(profile)) {
    throw configurationError('config/management-invalid', 'CI 配置档必须为 policy、full 或 release-ready');
  }
  const migration = migrateProjectConfig(root);
  const config = migration.config;
  const changed = !config.ci.enabled || config.ci.profile !== profile;
  config.ci.enabled = true;
  config.ci.profile = profile;
  if (changed) writeProjectConfig(root, config);
  return { changed, config, migrated: migration.changed };
}
