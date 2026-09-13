import { COMMIT_MESSAGE_PRESET } from '../../config/defaults.js';
import { preserveDirectoryBindings } from '../../config/directory-roles.js';
import { isDeepStrictEqual } from 'node:util';
import { frontendToolOptions } from '../../profiles/frontend-tool-presets.js';
import { frontendMaintenancePresets } from '../../profiles/frontend-maintenance-presets.js';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  loadWorkspace,
  readConfigurationDocument,
} from '../../config/configuration-loader.js';
import {
  createProjectDocument,
  normalizeProjectDocument,
  serializeProjectConfig,
} from '../../config/project-configuration.js';
import {
  PROJECT_CHECK_PATHS,
  setValueAtPath,
  valueAtPath,
} from '../../config/project-feature-paths.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { gateRegistry } from '../../gates/registry.js';
import {
  ensureBuildArtifactBaselineRule,
  ensureUiTokenManifestRule,
} from './config-copy.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { assertManagedDocumentFormats } from './managed-format-preflight.js';
import { assertHookInstallationSupported } from './hook-installer.js';

export const CONFIG_SCHEMA_PATH =
  './node_modules/@cxyi7/repo-guard/config.schema.json';
export const QUALITY_GATES = Object.freeze(
  gateRegistry.configurable
    .filter(({ id }) =>
      ['quality.eslint', 'quality.prettier', 'quality.stylelint'].includes(id),
    )
    .map(({ featureName }) => featureName),
);
const GATE_FEATURES = gateRegistry.configurable.map(
  ({ featureName }) => featureName,
);
export const CONFIGURABLE_FEATURES = Object.freeze([
  ...GATE_FEATURES,
  'coverage',
  'fileHeader',
  'notification',
  'commitAnimation',
  'ci',
]);

export function createStarterConfig({
  project = {
    id: 'app',
    role: 'frontend',
    stack: 'node',
    preset: 'vue-typescript',
  },
  architectureEnabled = false,
  buildEnabled = false,
  stylelintEnabled = false,
  typeCheckEnabled = false,
  unitTestEnabled = false,
} = {}) {
  return serializeProjectConfig(
    normalizeProjectDocument({
      version: 2,
      project,
      checks: {
        architecture: { enabled: architectureEnabled },
        build: { enabled: buildEnabled },
        stylelint: { enabled: stylelintEnabled, governance: { enabled: stylelintEnabled && project.role === 'frontend' } },
        typeCheck: { enabled: typeCheckEnabled },
        unitTest: { enabled: unitTestEnabled },
      },
      repository: {
        commitMessage: structuredClone(COMMIT_MESSAGE_PRESET),
        rules: [
          {
            pattern: 'package.json',
            category: '依赖与包元数据',
            level: 'notify',
          },
          {
            pattern: '**/package.json',
            category: '依赖与包元数据',
            level: 'notify',
          },
          {
            pattern: 'package-lock.json',
            category: '依赖锁文件',
            level: 'notify',
          },
          { pattern: '.env*', category: '环境配置', level: 'notify' },
          { pattern: 'src/main.*', category: '应用入口', level: 'notify' },
          { pattern: 'src/App.vue', category: '应用入口', level: 'notify' },
          {
            pattern: 'src/components/**',
            category: '共享组件',
            level: 'notify',
          },
          {
            pattern: '.githooks/**',
            category: '仓库守卫基础设施',
            level: 'notify',
          },
          {
            pattern: CONFIG_FILE,
            category: '仓库守卫基础设施',
            level: 'notify',
          },
          {
            pattern: '.repo-guard/knip-baseline.json',
            category: '无效代码历史债务基线',
            level: 'notify',
          },
          {
            pattern: '.repo-guard/build-artifact-baseline.json',
            category: '构建产物历史债务基线',
            level: 'notify',
          },
          {
            pattern: '{knip,.knip,knip.config}.{json,jsonc,js,ts,mjs,cjs}',
            category: '无效代码分析配置',
            level: 'notify',
          },
        ],
        exclusions: [],
      },
    }),
  );
}

function configPath(root) {
  return path.join(root, CONFIG_FILE);
}

function writeProjectConfig(root, value) {
  writeFileSync(
    configPath(root),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

export function ensureProjectConfig(root, options = {}) {
  if (existsSync(configPath(root))) {
    const workspace = loadWorkspace(root);
    assertManagedDocumentFormats(root, { workspace });
    assertHookInstallationSupported(root);
    return { created: false };
  }
  const document = createProjectDocument(options.project);
  assertManagedDocumentFormats(root);
  assertHookInstallationSupported(root);
  writeProjectConfig(root, serializeProjectConfig(document));
  return { created: true };
}

function featureConfig(config, feature) {
  if (PROJECT_CHECK_PATHS[feature])
    return valueAtPath(config, PROJECT_CHECK_PATHS[feature]);
  return valueAtPath(config, featureDocumentPath(feature));
}

function featureDocumentPath(feature) {
  if (Object.hasOwn(PROJECT_CHECK_PATHS, feature)) return ['checks', feature];
  if (feature === 'dependencies') return ['repository', 'dependencyPolicy'];
  if (feature === 'repositoryFilePlacement') return ['repository', 'filePlacement'];
  if (['commitMessage', 'codePlacement', 'deliveryContract'].includes(feature))
    return ['repository', feature];
  if (feature === 'notification' || feature === 'commitAnimation')
    return ['reporting', feature];
  if (feature === 'ci') return ['ci'];
  throw configurationError(
    'config/management-invalid',
    `不支持的可配置功能：${feature}。`,
  );
}

function effectiveFeaturesFor(requestedFeatures, enabled) {
  if (typeof enabled !== 'boolean')
    throw configurationError(
      'config/management-invalid',
      '功能状态必须是布尔值',
    );
  if (!Array.isArray(requestedFeatures) || requestedFeatures.length === 0) {
    throw configurationError(
      'config/management-invalid',
      `请至少选择一项功能：${CONFIGURABLE_FEATURES.join(', ')}。`,
    );
  }
  const unique = [...new Set(requestedFeatures)];
  const unsupported = unique.filter(
    (feature) => !CONFIGURABLE_FEATURES.includes(feature),
  );
  if (unsupported.length > 0)
    throw configurationError(
      'config/management-invalid',
      `不支持的功能：${unsupported.join(', ')}。`,
    );
  const related = [];
  if (
    enabled &&
    unique.some((feature) =>
      ['coverage'].includes(feature),
    )
  )
    related.push('unitTest');
  if (!enabled && unique.includes('unitTest'))
    related.push('coverage');

  if (enabled && unique.includes('unusedImageAssets'))
    related.push('imageAssets');
  if (!enabled && unique.includes('imageAssets'))
    related.push('unusedImageAssets');
  return [...new Set([...related, ...unique])];
}

function isApplicationFeature(feature) {
  return Object.hasOwn(PROJECT_CHECK_PATHS, feature) || ['dependencies', 'codePlacement'].includes(feature);
}

function selectApplication(workspace, features, projectId) {
  if (projectId !== undefined) {
    const selected = workspace.projects.find(
      (project) => project.id === projectId,
    );
    if (!selected)
      throw configurationError(
        'project/not-found',
        `未配置项目：${projectId}。`,
      );
    return selected;
  }
  if (workspace.projects.length === 1) return workspace.projects[0];
  if (features.some(isApplicationFeature)) {
    throw configurationError(
      'project/selection-required',
      '修改应用检查时必须使用 --project 显式选择应用。',
    );
  }
  return null;
}

function validateAndWriteDocuments(workspace, replacements) {
  const candidate = loadWorkspace(workspace.root, {
    lazyProjects: true,
    readDocument: (relative) =>
      replacements.get(path.resolve(workspace.root, relative)) ??
      readConfigurationDocument(path.resolve(workspace.root, relative)),
  });
  candidate.projects.filter((project) => replacements.has(workspace.configPath) || replacements.has(project.configPath)).forEach((project) => project.config);
  const original = new Map(
    [...replacements.keys()].map((file) => [file, readFileSync(file, 'utf8')]),
  );
  const written = [];
  try {
    for (const [file, document] of replacements) {
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      written.push(file);
    }
  } catch (error) {
    for (const file of written) writeFileSync(file, original.get(file), 'utf8');
    throw configurationError(
      'config/write-failed',
      '配置写入失败；已恢复本次写入成功的文件，请检查配置目录的写入权限。',
      { cause: error },
    );
  }
}

function protectProjectArtifacts(rules, config, relativeRoot = '.') {
  const relativeFile = (file) => path.posix.join(relativeRoot, file);
  const baseline = config.checks.build.artifactBudget;
  return ensureUiTokenManifestRule(
    ensureBuildArtifactBaselineRule(rules, {
      ...config.checks.build,
      artifactBudget: {
        ...baseline,
        baselineFile: relativeFile(baseline.baselineFile),
      },
    }),
    {
      ...config.checks.stylelint.uiTokens,
      manifestFile: relativeFile(config.checks.stylelint.uiTokens.manifestFile),
    },
  );
}

function protectWorkspaceArtifacts(workspace, replacements) {
  const candidate = loadWorkspace(workspace.root, {
    lazyProjects: true,
    readDocument: (relative) =>
      replacements.get(path.resolve(workspace.root, relative)) ??
      readConfigurationDocument(path.resolve(workspace.root, relative)),
  });
  for (const project of candidate.projects.filter((item) => replacements.has(item.configPath))) {
    const document = replacements.get(project.configPath) ?? readConfigurationDocument(project.configPath);
    const originalRules = document.repository?.rules ?? project.config.repository.rules.map(
      ({ pattern, category, level }) => ({ pattern, category, level }));
    const rules = protectProjectArtifacts(originalRules, project.config);
    if (!isDeepStrictEqual(rules, originalRules)) replacements.set(project.configPath, {
      ...document, repository: { ...document.repository, rules },
    });
  }
}

/** 性能配置按对象补缺，数组整项替换；已写入的用户值始终优先。 */
function mergePerformanceDefaults(base, override) {
  const result = structuredClone(base ?? {});
  for (const [key, value] of Object.entries(override ?? {})) {
    const object = value !== null && typeof value === 'object' && !Array.isArray(value);
    result[key] = object && result[key] !== null && typeof result[key] === 'object' && !Array.isArray(result[key])
      ? mergePerformanceDefaults(result[key], value) : structuredClone(value);
  }
  return result;
}

export function setFeaturesEnabled(
  root,
  requestedFeatures,
  enabled,
  options = {},
) {
  const effectiveFeatures = effectiveFeaturesFor(requestedFeatures, enabled);
  const workspace = loadWorkspace(root, { lazyProjects: true });
  const application = selectApplication(
    workspace,
    effectiveFeatures,
    options.projectId,
  );
  assertManagedDocumentFormats(root, { workspace, projectId: application?.id });
  const replacements = new Map();
  const changed = [];
  const unchanged = [];
  for (const feature of effectiveFeatures) {
    const fields = featureDocumentPath(feature);
    const appCheck = isApplicationFeature(feature);
    const file = appCheck ? application.configPath : workspace.configPath;
    const normalized = appCheck
      ? application.config
      : workspace.repositoryConfig;
    const previous = featureConfig(normalized, feature);
    const maintenance = enabled
      ? feature === 'commitMessage' ? COMMIT_MESSAGE_PRESET : frontendMaintenancePresets(application?.project)[feature]
      : undefined;
    const presetOptions = enabled && previous.options === undefined
      ? frontendToolOptions(feature, application?.project) : undefined;
    if (previous.enabled === enabled && !presetOptions && !maintenance) {
      unchanged.push(feature);
      continue;
    }
    const document = replacements.get(file) ?? readConfigurationDocument(file);
    const existing = valueAtPath(document, fields) ?? {};
    const values = ['stylelint', 'build', 'lighthouse', 'imageAssets', 'unusedImageAssets', 'deadCode', 'commitMessage'].includes(feature)
      ? mergePerformanceDefaults(mergePerformanceDefaults(previous, maintenance), existing)
      : { ...structuredClone(previous), ...maintenance, ...structuredClone(existing) };
    const next = { ...values, enabled,
      ...(presetOptions ? { options: presetOptions } : {}) };
    const updated = preserveDirectoryBindings(setValueAtPath(document, fields, next), document, feature);
    if (isDeepStrictEqual(document, updated)) { unchanged.push(feature); continue; }
    replacements.set(file, updated);
    changed.push(feature);
  }
  if (changed.length > 0) {
    protectWorkspaceArtifacts(workspace, replacements);
    validateAndWriteDocuments(workspace, replacements);
  }
  return { changed, targetEnabled: enabled, unchanged };
}

export function enableQualityGates(root, requestedGates, options = {}) {
  const unsupported = requestedGates.filter(
    (gate) => !QUALITY_GATES.includes(gate),
  );
  if (unsupported.length > 0)
    throw configurationError(
      'config/management-invalid',
      `不支持的质量门禁：${unsupported.join(', ')}。`,
    );
  const result = setFeaturesEnabled(root, requestedGates, true, options);
  return {
    alreadyEnabled: result.unchanged,
    enabled: result.changed,
  };
}

export function configureCi(root, { profile = 'policy' } = {}) {
  if (!['policy', 'full', 'release-ready'].includes(profile)) {
    throw configurationError(
      'config/management-invalid',
      'CI 配置档必须为 policy、full 或 release-ready',
    );
  }
  const workspace = loadWorkspace(root);
  assertManagedDocumentFormats(root, { workspace });
  const changed =
    !workspace.repositoryConfig.ci.enabled ||
    workspace.repositoryConfig.ci.profile !== profile;
  const document = {
    ...workspace.document,
    ci: { ...workspace.document.ci, enabled: true, profile },
  };
  if (changed)
    validateAndWriteDocuments(
      workspace,
      new Map([[workspace.configPath, document]]),
    );
  const config = loadWorkspace(root).repositoryConfig;
  return { changed, config, document };
}
