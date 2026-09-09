import { configurationError } from '../../core/error/repo-guard-error.js';

const IDENTIFIER = /^[a-z][a-z0-9-]{0,47}$/;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

function fail(location, message) {
  throw configurationError('operations/invalid-config', `${location}：${message}`);
}

export function requireObject(value, location, keys = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(location, '必须是对象');
  }
  if (keys) {
    const unknown = Object.keys(value).filter((key) => !keys.includes(key));
    if (unknown.length) fail(location, `存在未知字段 ${unknown.join('、')}`);
  }
  return value;
}

export function requireIdentifier(value, location) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail(location, '必须使用小写英文字母开头、最多 48 个字母数字或连字符');
  }
  return value;
}

export function requireRelativePath(value, location, { allowRoot = false } = {}) {
  if (allowRoot && value === '.') return value;
  if (typeof value !== 'string' || !value || value.startsWith('/')
      || !/^[A-Za-z0-9._/-]+$/.test(value)
      || value.split('/').some((part) => part === '..' || part === '.')) {
    fail(location, '必须是仓库内的相对路径，不得包含空格、通配符、反斜杠或上级目录');
  }
  const normalized = value.replace(/\/+$/, '');
  if (!normalized || normalized.split('/').some((part) => !part)) {
    fail(location, '路径不得为空或包含重复分隔符');
  }
  return normalized;
}

function booleanValue(value, location, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(location, '必须是布尔值');
  return value;
}

function scriptName(value, location) {
  if (typeof value !== 'string' || !SCRIPT_NAME.test(value)) {
    fail(location, '必须是明确的 package.json 脚本名，不能填写命令');
  }
  return value;
}

function environmentConfig(value, location) {
  requireObject(value, location, ['script', 'production', 'branches']);
  if (!Array.isArray(value.branches) || value.branches.length === 0
      || value.branches.some((branch) => typeof branch !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch))) {
    fail(`${location}.branches`, '必须明确列出允许部署的分支，不支持通配符或表达式');
  }
  return {
    script: scriptName(value.script, `${location}.script`),
    production: booleanValue(value.production, `${location}.production`, true),
    branches: [...new Set(value.branches)],
  };
}

function projectConfig(value, location) {
  requireObject(value, location, [
    'enabled', 'qualityProfile', 'buildScript', 'artifactPaths', 'environments',
  ]);
  const enabled = booleanValue(value.enabled, `${location}.enabled`, false);
  const qualityProfile = value.qualityProfile ?? 'full';
  if (!['full', 'release-ready'].includes(qualityProfile)) {
    fail(`${location}.qualityProfile`, '必须为 full 或 release-ready');
  }
  const environments = requireObject(value.environments ?? {}, `${location}.environments`);
  const parsedEnvironments = Object.fromEntries(Object.entries(environments).map(([id, environment]) => {
    requireIdentifier(id, `${location}.environments`);
    return [id, environmentConfig(environment, `${location}.environments.${id}`)];
  }));
  if (enabled && (!Array.isArray(value.artifactPaths) || value.artifactPaths.length === 0)) {
    fail(`${location}.artifactPaths`, '启用应用发布时必须明确声明至少一个构建产物路径');
  }
  if (value.artifactPaths !== undefined && !Array.isArray(value.artifactPaths)) {
    fail(`${location}.artifactPaths`, '必须是相对路径数组');
  }
  return {
    enabled,
    qualityProfile,
    buildScript: enabled || value.buildScript != null
      ? scriptName(value.buildScript, `${location}.buildScript`) : null,
    artifactPaths: [...new Set((value.artifactPaths ?? []).map((item) => requireRelativePath(
      item, `${location}.artifactPaths`,
    )))],
    environments: parsedEnvironments,
  };
}

export function validateOperationsConfig(value) {
  requireObject(value, '运维配置', ['$schema', 'version', 'enabled', 'provider', 'projects']);
  if (value.$schema !== undefined && typeof value.$schema !== 'string') {
    fail('$schema', '必须是字符串');
  }
  if (value.version !== 2) fail('version', '必须为 2');
  if (value.provider !== undefined && value.provider !== 'gitlab') {
    fail('provider', '当前仅支持 gitlab');
  }
  const projects = requireObject(value.projects ?? {}, 'projects');
  return {
    version: 2,
    enabled: booleanValue(value.enabled, 'enabled', false),
    provider: 'gitlab',
    projects: Object.fromEntries(Object.entries(projects).map(([id, project]) => {
      requireIdentifier(id, 'projects');
      return [id, projectConfig(project, `projects.${id}`)];
    })),
  };
}
