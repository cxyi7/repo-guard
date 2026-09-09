import { configurationError } from '../core/error/repo-guard-error.js';
import { validateProjectDescriptor } from '../profiles/project-profiles.js';
import { validateConfig } from './configuration-validation.js';
import { PROJECT_CHECK_PATHS, REPOSITORY_FIELDS, setValueAtPath, valueAtPath } from './project-feature-paths.js';
import { assertKnownProperties, configValidationError, CONFIG_FILE } from './validation-primitives.js';

export const PROJECT_SCHEMA_PATH = './node_modules/@cxyi7/repo-guard/config.schema.json';
const PROJECT_FIELDS = new Set(['$schema', 'version', 'project', 'checks', 'repository', 'reporting', 'ci']);
const REPORTING_FIELDS = new Set(['notification', 'commitAnimation']);
const CI_FIELDS = new Set(['enabled', 'profile', 'reportPath', 'protectedFiles', 'gatePolicy', 'externalGates']);
const FRONTEND_ONLY = new Set(['componentInteraction', 'lighthouse', 'accessibilityTest', 'uiTokens', 'asyncResourceCleanup']);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
}

export function assertProjectDocumentVersion(document) {
  assertObject(document, CONFIG_FILE);
  if (document.version === 1) {
    throw configurationError('config/migration-required', '配置版本 1 已停止直接执行；请显式指定项目身份并运行 repo-guard migrate，迁移为版本 2。');
  }
  if (document.version !== 2) throw configValidationError('配置 version 必须为 2');
}

function createProfileBase(project) {
  const backend = project.role === 'backend';
  return {
    version: 1,
    rules: [{ pattern: CONFIG_FILE, category: '团队工程规范', level: 'notify' }],
    ...(backend ? {
      preCommit: {
        eslint: { pattern: '*.{js,mjs,cjs,ts,mts,cts}' },
        prettier: { pattern: '*.{js,mjs,cjs,ts,mts,cts,json,json5,jsonc,md,yml,yaml}' },
        maxFileLines: { rules: [{ pattern: '**/*.{js,mjs,cjs,ts,mts,cts}', maxLines: 1000 }] },
        filePlacement: { rules: [{
          name: '测试文件', patterns: ['**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts}'],
          allowedPatterns: ['test/**', 'tests/**', '**/__tests__/**', 'src/**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts}'],
          exceptions: [], suggestedDirectory: 'test',
        }] },
      },
      unitTest: {
        sourcePatterns: ['src/**/*.{js,mjs,cjs,ts,mts,cts}'],
        exclusions: ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts', '**/*.{spec,test}.*', '**/__tests__/**', 'src/generated/**'],
      },
    } : {}),
  };
}

function checkDuplicateNestedFields(checks) {
  for (const [feature, segments] of Object.entries(PROJECT_CHECK_PATHS)) {
    if (segments.length < 2) continue;
    const parent = Object.entries(PROJECT_CHECK_PATHS).find(([, candidate]) => (
      candidate.length === segments.length - 1 && candidate.every((item, index) => item === segments[index])
    ));
    if (parent && Object.hasOwn(checks[parent[0]] ?? {}, segments.at(-1))) {
      throw configValidationError(`checks.${parent[0]}.${segments.at(-1)} 已移动为 checks.${feature}，不得重复嵌套配置`);
    }
  }
}

function applyDocument(base, document, options) {
  const checks = document.checks ?? {};
  assertObject(checks, 'checks');
  assertKnownProperties(checks, new Set(Object.keys(PROJECT_CHECK_PATHS)), 'checks');
  checkDuplicateNestedFields(checks);
  let result = base;
  for (const feature of Object.keys(PROJECT_CHECK_PATHS)) {
    if (!Object.hasOwn(checks, feature)) continue;
    const candidate = checks[feature];
    assertObject(candidate, `checks.${feature}`);
    result = setValueAtPath(result, PROJECT_CHECK_PATHS[feature], {
      ...valueAtPath(result, PROJECT_CHECK_PATHS[feature]),
      ...candidate,
    });
  }
  for (const [section, fields] of [
    ['repository', new Set(REPOSITORY_FIELDS)], ['reporting', REPORTING_FIELDS], ['ci', CI_FIELDS],
  ]) {
    if (options[section] !== undefined && document[section] !== undefined) {
      throw configValidationError(`子应用不得覆盖仓库统一的 ${section} 配置`);
    }
    const candidate = options[section] ?? document[section] ?? {};
    assertObject(candidate, section);
    assertKnownProperties(candidate, fields, section);
    if (section === 'ci') {
      const { externalGates, ...ci } = candidate;
      result = { ...result, ci, ...(externalGates !== undefined ? { externalGates } : {}) };
    } else result = { ...result, ...structuredClone(candidate) };
  }
  return result;
}

/** 将磁盘 v2 配置映射为经过校验的稳定执行契约，纯函数，不读取环境。 */
export function normalizeProjectDocument(document, options = {}) {
  assertProjectDocumentVersion(document);
  assertKnownProperties(document, PROJECT_FIELDS, options.configPath ?? CONFIG_FILE);
  const project = validateProjectDescriptor(document.project, options);
  const internal = applyDocument(createProfileBase(project), document, options);
  if (project.role === 'backend') {
    for (const feature of FRONTEND_ONLY) {
      if (valueAtPath(internal, PROJECT_CHECK_PATHS[feature])?.enabled) {
        throw configValidationError(`checks.${feature} 仅适用于前端项目，不能用于后端预设`);
      }
    }
  }
  const validated = validateConfig(internal, options.configPath ?? CONFIG_FILE);
  return { ...validated, configVersion: 2, project };
}

function serializedCheck(config, feature, segments) {
  const value = structuredClone(valueAtPath(config, segments));
  for (const child of Object.values(PROJECT_CHECK_PATHS)) {
    if (child.length === segments.length + 1 && segments.every((item, index) => item === child[index])) {
      delete value[child.at(-1)];
    }
  }
  return [feature, value];
}

/** 写回外部配置时移除内部正则、执行版本和旧运维字段。 */
export function serializeProjectConfig(normalized) {
  const project = validateProjectDescriptor(normalized.project, { allowUnsupported: true });
  const repository = Object.fromEntries(REPOSITORY_FIELDS.map((key) => [key, structuredClone(normalized[key])]));
  repository.rules = normalized.rules.map(({ pattern, category, level }) => ({ pattern, category, level }));
  repository.exclusions = normalized.exclusions.map((entry) => typeof entry === 'string' ? entry : entry.pattern);
  const { pipeline: ignoredPipeline, ...ci } = normalized.ci;
  void ignoredPipeline;
  return {
    $schema: PROJECT_SCHEMA_PATH,
    version: 2,
    project,
    checks: Object.fromEntries(Object.entries(PROJECT_CHECK_PATHS).map(([feature, segments]) => (
      serializedCheck(normalized, feature, segments)
    ))),
    repository,
    reporting: { notification: structuredClone(normalized.notification), commitAnimation: structuredClone(normalized.commitAnimation) },
    ci: { ...structuredClone(ci), externalGates: structuredClone(normalized.externalGates) },
  };
}

export function createProjectDocument(descriptor) {
  return serializeProjectConfig(normalizeProjectDocument({ version: 2, project: descriptor }));
}

/** 仓库执行仅使用公共规则，不选择任意应用作为默认身份。 */
export function normalizeRepositoryDocument(document, options = {}) {
  const internal = applyDocument({
    version: 1,
    rules: [{ pattern: CONFIG_FILE, category: '团队工程规范', level: 'notify' }],
  }, { repository: document.repository, reporting: document.reporting, ci: document.ci }, options);
  return { ...validateConfig(internal, options.configPath ?? CONFIG_FILE), configVersion: 2 };
}

/** 迁移保持原有规则和阈值，运维策略由独立模块接管；不替用户推断身份。 */
export function migrateLegacyConfig(legacy, descriptor) {
  const project = validateProjectDescriptor(descriptor);
  const validated = validateConfig(legacy);
  const document = serializeProjectConfig({ ...validated, project });
  normalizeProjectDocument(document);
  return { document, operations: structuredClone(validated.ci.pipeline) };
}
