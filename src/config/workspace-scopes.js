import { assertKnownProperties, configValidationError } from './validation-primitives.js';

export const APPLICATION_REPOSITORY_FIELDS = Object.freeze([
  'rules', 'exclusions', 'exceptions', 'dependencyPolicy', 'codePlacement',
]);
export const SHARED_REPOSITORY_FIELDS = Object.freeze([
  'rules', 'exclusions', 'commitMessage', 'deliveryContract', 'filePlacement',
]);
export const APPLICATION_CI_FIELDS = Object.freeze(['protectedFiles', 'gatePolicy', 'externalGates']);

function assertSection(value, fields, label) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(value, new Set(fields), label);
}

/** 共享的是流程设置；应用策略不从仓库入口继承。 */
export function applicationDocument(document, shared) {
  if (document.reporting !== undefined) throw configValidationError('子应用不得覆盖仓库统一的 reporting 配置');
  assertSection(document.repository, APPLICATION_REPOSITORY_FIELDS, '子应用 repository');
  assertSection(document.ci, APPLICATION_CI_FIELDS, '子应用 ci');
  const gatePolicy = document.ci?.gatePolicy;
  assertSection(gatePolicy, ['defaultMode', 'gates'], '子应用 ci.gatePolicy');
  return {
    ...document,
    reporting: shared.reporting,
    ci: {
      enabled: shared.ci?.enabled,
      profile: shared.ci?.profile,
      ...document.ci,
      gatePolicy: {
        ...gatePolicy,
        defaultMode: gatePolicy?.defaultMode === undefined
          ? shared.ci?.gatePolicy?.defaultMode : gatePolicy.defaultMode,
      },
    },
  };
}

export function assertWorkspaceScopes(document) {
  assertSection(document.repository, SHARED_REPOSITORY_FIELDS, '仓库公共 repository');
  if (document.ci?.externalGates !== undefined) {
    throw configValidationError('外部门禁必须配置在所属应用的 ci.externalGates 中');
  }
  const sharedPaths = document.sharedPaths ?? [];
  if (!Array.isArray(sharedPaths)) throw configValidationError('sharedPaths 必须是数组');
  for (const entry of sharedPaths) {
    assertSection(entry, ['path', 'projects'], 'sharedPaths 条目');
    if (!entry || typeof entry.path !== 'string'
      || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(entry.path)
      || entry.path.split('/').some((part) => part === '.' || part === '..')
      || !Array.isArray(entry.projects) || entry.projects.length === 0
      || new Set(entry.projects).size !== entry.projects.length
      || entry.projects.some((id) => !document.projects?.some((project) => project.id === id))) {
      throw configValidationError('sharedPaths 必须声明仓库内的文件或目录，以及不重复的已登记应用标识');
    }
  }
}
