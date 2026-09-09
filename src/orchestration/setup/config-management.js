import { isDeepStrictEqual } from 'node:util';
import { loadWorkspace, readConfigurationDocument } from '../../config/configuration-loader.js';
import { createProjectDocument, migrateLegacyConfig, normalizeProjectDocument } from '../../config/project-configuration.js';
import { PROJECT_CHECK_PATHS, setValueAtPath, valueAtPath } from '../../config/project-feature-paths.js';
import { DEFAULT_CI_PIPELINE_CONFIG } from '../../config/defaults.js';
import { DEFAULT_COMMIT_ANIMATION_CONFIG } from '../../config/commit-animation-validation.js';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { gateRegistry } from '../../gates/registry.js';
import { assertExceptionLifecycleCurrent } from '../../config/exception-lifecycle.js';
import {
  DEFAULT_CI_CONFIG,
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
} from '../../config/defaults.js';
import {
  cloneArchitectureConfig,
  cloneAsyncResourceCleanupConfig,
  cloneBuildConfig,
  cloneCiPipelineConfig,
  cloneCodePlacementConfig,
  cloneCommitMessageConfig,
  cloneDeadCodeConfig,
  cloneDependencyPolicyConfig,
  cloneDeliveryContractConfig,
  cloneExceptionsConfig,
  cloneFileHeaderConfig,
  cloneFilePlacementConfig,
  cloneFunctionDocConfig,
  cloneImageAssetsConfig,
  cloneMutationTestConfig,
  clonePathNamingConfig,
  cloneStylelintConfig,
  cloneUnitTestConfig,
  cloneUiTokensConfig,
  ensureBuildArtifactBaselineRule,
  ensureUiTokenManifestRule,
} from './config-copy.js';
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
  'commitAnimation',
  'ci',
]);

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
    commitAnimation: { ...DEFAULT_COMMIT_ANIMATION_CONFIG },
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
    uiTokens: cloneUiTokensConfig(),
    deliveryContract: cloneDeliveryContractConfig(),
    architecture: cloneArchitectureConfig({ enabled: architectureEnabled }),
    accessibilityTest: {
      ...DEFAULT_ACCESSIBILITY_TEST_CONFIG,
      enabled: accessibilityTestEnabled,
      testPatterns: [...DEFAULT_ACCESSIBILITY_TEST_CONFIG.testPatterns],
    },
    build: cloneBuildConfig({ enabled: buildEnabled }),
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
      { pattern: '.repo-guard/build-artifact-baseline.json', category: '构建产物历史债务基线', level: 'notify' },
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

function writeProjectConfig(root, value) {
  writeFileSync(configPath(root), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function ensureProjectConfig(root, options = {}) {
  if (existsSync(configPath(root))) {
    loadWorkspace(root);
    return { created: false };
  }
  const document = createProjectDocument(options.project);
  writeProjectConfig(root, document);
  return { created: true };
}

export function migrateProjectConfig(root, options = {}) {
  const current = readConfigurationDocument(configPath(root));
  if (current.version === 2) {
    const workspace = loadWorkspace(root, options);
    return { changed: false, config: workspace.repositoryConfig, document: current };
  }
  const migration = migrateLegacyConfig(current, options.project);
  if (!isDeepStrictEqual(migration.operations, DEFAULT_CI_PIPELINE_CONFIG)) {
    throw configurationError('config/operations-migration-required', '旧 ci.pipeline 包含运维设置；必须先按 operations.schema.json 明确迁移独立流水线、产物和发布环境。本次未写入任何配置，原文件已保留。');
  }
  migration.document.repository.rules = protectProjectArtifacts(
    migration.document.repository.rules,
    normalizeProjectDocument(migration.document),
  );
  const config = normalizeProjectDocument(migration.document);
  if (!options.allowExpiredExceptions) {
    assertExceptionLifecycleCurrent(config.exceptions, { now: options.now ?? new Date() });
  }
  const backupPath = path.join(root, 'repo-guard.config.v1.backup.json');
  // 独占创建备份，避免二次迁移覆盖用户保存的原始配置。
  try {
    writeFileSync(backupPath, readFileSync(configPath(root)), { flag: 'wx' });
  } catch (error) {
    throw configurationError('config/backup-failed', '无法创建旧配置备份；请保留并检查 repo-guard.config.v1.backup.json，本次未修改配置。', { cause: error });
  }
  writeProjectConfig(root, migration.document);
  return { changed: true, config, document: migration.document, backupPath };
}

function featureConfig(config, feature) {
  if (PROJECT_CHECK_PATHS[feature]) return valueAtPath(config, PROJECT_CHECK_PATHS[feature]);
  if (feature === 'dependencies') return config.dependencyPolicy;
  return config[feature];
}

function featureDocumentPath(feature) {
  if (Object.hasOwn(PROJECT_CHECK_PATHS, feature)) return ['checks', feature];
  if (feature === 'dependencies') return ['repository', 'dependencyPolicy'];
  if (['commitMessage', 'codePlacement', 'deliveryContract'].includes(feature)) return ['repository', feature];
  if (feature === 'notification' || feature === 'commitAnimation') return ['reporting', feature];
  if (feature === 'ci') return ['ci'];
  throw configurationError('config/management-invalid', `不支持的可配置功能：${feature}。`);
}

function effectiveFeaturesFor(requestedFeatures, enabled) {
  if (typeof enabled !== 'boolean') throw configurationError('config/management-invalid', '功能状态必须是布尔值');
  if (!Array.isArray(requestedFeatures) || requestedFeatures.length === 0) {
    throw configurationError('config/management-invalid', `请至少选择一项功能：${CONFIGURABLE_FEATURES.join(', ')}。`);
  }
  const unique = [...new Set(requestedFeatures)];
  const unsupported = unique.filter((feature) => !CONFIGURABLE_FEATURES.includes(feature));
  if (unsupported.length > 0) throw configurationError('config/management-invalid', `不支持的功能：${unsupported.join(', ')}。`);
  const related = [];
  if (enabled && unique.some((feature) => ['coverage', 'componentInteraction'].includes(feature))) related.push('unitTest');
  if (!enabled && unique.includes('unitTest')) related.push('componentInteraction', 'coverage');
  if (enabled && unique.some((feature) => ['styleComplexity', 'styleGovernance'].includes(feature))) related.push('stylelint');
  if (!enabled && unique.includes('stylelint')) related.push('styleComplexity', 'styleGovernance');
  if (enabled && unique.includes('unusedImageAssets')) related.push('imageAssets');
  if (!enabled && unique.includes('imageAssets')) related.push('unusedImageAssets');
  return [...new Set([...related, ...unique])];
}

function selectApplication(workspace, features, projectId) {
  if (projectId !== undefined) {
    const selected = workspace.projects.find((project) => project.id === projectId);
    if (!selected) throw configurationError('project/not-found', `未配置项目：${projectId}。`);
    return selected;
  }
  if (workspace.projects.length === 1) return workspace.projects[0];
  if (features.some((feature) => Object.hasOwn(PROJECT_CHECK_PATHS, feature))) {
    throw configurationError('project/selection-required', '修改应用检查时必须使用 --project 显式选择应用。');
  }
  return null;
}

function stripChildFeatures(value, feature) {
  const segments = PROJECT_CHECK_PATHS[feature];
  if (!segments) return value;
  for (const child of Object.values(PROJECT_CHECK_PATHS)) {
    if (child.length === segments.length + 1 && segments.every((item, index) => item === child[index])) {
      delete value[child.at(-1)];
    }
  }
  return value;
}

function validateAndWriteDocuments(workspace, replacements) {
  loadWorkspace(workspace.root, {
    readDocument: (relative) => replacements.get(path.resolve(workspace.root, relative))
      ?? readConfigurationDocument(path.resolve(workspace.root, relative)),
  });
  const original = new Map([...replacements.keys()].map((file) => [file, readFileSync(file, 'utf8')]));
  const written = [];
  try {
    for (const [file, document] of replacements) {
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      written.push(file);
    }
  } catch (error) {
    for (const file of written) writeFileSync(file, original.get(file), 'utf8');
    throw configurationError('config/write-failed', '配置写入失败；已恢复本次写入成功的文件，请检查配置目录的写入权限。', { cause: error });
  }
}

function protectProjectArtifacts(rules, config, relativeRoot = '.') {
  const relativeFile = (file) => path.posix.join(relativeRoot, file);
  const baseline = config.build.artifactBudget;
  return ensureUiTokenManifestRule(
    ensureBuildArtifactBaselineRule(rules, {
      ...config.build,
      artifactBudget: { ...baseline, baselineFile: relativeFile(baseline.baselineFile) },
    }),
    { ...config.uiTokens, manifestFile: relativeFile(config.uiTokens.manifestFile) },
  );
}

function protectWorkspaceArtifacts(workspace, replacements) {
  const candidate = loadWorkspace(workspace.root, {
    readDocument: (relative) => replacements.get(path.resolve(workspace.root, relative))
      ?? readConfigurationDocument(path.resolve(workspace.root, relative)),
  });
  const document = replacements.get(workspace.configPath) ?? workspace.document;
  const originalRules = document.repository?.rules
    ?? candidate.repositoryConfig.rules.map(({ pattern, category, level }) => ({ pattern, category, level }));
  let rules = originalRules;
  for (const project of candidate.projects) {
    rules = protectProjectArtifacts(rules, project.config, project.relativeRoot);
  }
  if (!isDeepStrictEqual(rules, originalRules)) {
    replacements.set(workspace.configPath, { ...document, repository: { ...document.repository, rules } });
  }
}

export function setFeaturesEnabled(root, requestedFeatures, enabled, options = {}) {
  const effectiveFeatures = effectiveFeaturesFor(requestedFeatures, enabled);
  const workspace = loadWorkspace(root);
  const application = selectApplication(workspace, effectiveFeatures, options.projectId);
  const replacements = new Map();
  const changed = [];
  const unchanged = [];
  for (const feature of effectiveFeatures) {
    const fields = featureDocumentPath(feature);
    const appCheck = fields[0] === 'checks';
    const file = appCheck ? application.configPath : workspace.configPath;
    const normalized = appCheck ? application.config : workspace.repositoryConfig;
    const previous = featureConfig(normalized, feature);
    if (previous.enabled === enabled) {
      unchanged.push(feature);
      continue;
    }
    const document = replacements.get(file) ?? readConfigurationDocument(file);
    const existing = valueAtPath(document, fields) ?? previous;
    // ci 的内部字段 pipeline 不属于 v2 外部配置。
    const next = stripChildFeatures({ ...structuredClone(existing), enabled }, feature);
    if (feature === 'ci') delete next.pipeline;
    replacements.set(file, setValueAtPath(document, fields, next));
    changed.push(feature);
  }
  if (changed.length > 0) {
    protectWorkspaceArtifacts(workspace, replacements);
    validateAndWriteDocuments(workspace, replacements);
  }
  return { changed, migrated: false, targetEnabled: enabled, unchanged };
}

export function enableQualityGates(root, requestedGates, options = {}) {
  const unsupported = requestedGates.filter((gate) => !QUALITY_GATES.includes(gate));
  if (unsupported.length > 0) throw configurationError('config/management-invalid', `不支持的质量门禁：${unsupported.join(', ')}。`);
  const result = setFeaturesEnabled(root, requestedGates, true, options);
  return { alreadyEnabled: result.unchanged, enabled: result.changed, migrated: false };
}

export function configureCi(root, { profile = 'policy' } = {}) {
  if (!['policy', 'full', 'release-ready'].includes(profile)) {
    throw configurationError('config/management-invalid', 'CI 配置档必须为 policy、full 或 release-ready');
  }
  const workspace = loadWorkspace(root);
  const changed = !workspace.repositoryConfig.ci.enabled || workspace.repositoryConfig.ci.profile !== profile;
  const document = { ...workspace.document, ci: { ...workspace.document.ci, enabled: true, profile } };
  if (changed) validateAndWriteDocuments(workspace, new Map([[workspace.configPath, document]]));
  const config = loadWorkspace(root).repositoryConfig;
  return { changed, config, document, migrated: false };
}
