import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { configurationError, toRepoGuardError } from '../core/error/repo-guard-error.js';
import { assertExceptionLifecycleCurrent } from './exception-lifecycle.js';
import { assertProjectDocumentVersion, normalizeProjectDocument, normalizeRepositoryDocument } from './project-configuration.js';
import { assertKnownProperties, CONFIG_FILE, configValidationError } from './validation-primitives.js';

export function readConfigurationDocument(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw configurationError('config/read-failed', `无法读取配置文件 ${configPath}：${error.message}`, {
      details: { location: { path: configPath } },
      expected: '配置文件必须存在且包含有效的 JSON。',
      remediation: {
        goal: '恢复可读取且有效的项目配置。',
        steps: ['按照 config.schema.json 创建或修正配置文件。'],
        constraints: ['不得通过删除必需策略来绕过校验。'],
        verification: ['重新执行 repo-guard doctor。'],
      },
      cause: error,
    });
  }
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function canonicalSnapshotPath(target, label) {
  let current = target;
  const missing = [];
  while (true) {
    try {
      const resolved = realpathSync(current);
      if (missing.length > 0 && !statSync(resolved).isDirectory()) {
        throw configValidationError(`${label} 的父路径必须是目录`);
      }
      return path.resolve(resolved, ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw toRepoGuardError(error, { kind: 'configuration', code: 'config/path-unreadable' });
      try {
        if (lstatSync(current).isSymbolicLink()) throw configValidationError(`${label} 不得经过无法解析的符号链接`);
      } catch (linkError) {
        if (linkError.code !== 'ENOENT') throw toRepoGuardError(linkError, { kind: 'configuration', code: 'config/path-unreadable' });
      }
      const parent = path.dirname(current);
      if (parent === current) throw configValidationError(`${label} 无法解析所属文件系统`);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function resolveOwnedPath(root, relative, label, { directory = false, snapshot = false } = {}) {
  if (typeof relative !== 'string' || relative.length === 0
    || relative !== relative.trim() || relative.includes('\\')
    || relative.split('/').includes('..') || relative.includes(':') || path.isAbsolute(relative)) {
    throw configValidationError(`${label} 必须使用仓库内的相对路径，不得使用反斜杠、上级目录或绝对路径`);
  }
  const target = path.resolve(root, relative);
  if (!isWithin(root, target)) throw configValidationError(`${label} 不得越出所属目录`);
  let resolved;
  let stats;
  try {
    resolved = realpathSync(target);
    stats = statSync(resolved);
  } catch (error) {
    if (snapshot && error.code === 'ENOENT') {
      if (!isWithin(canonicalSnapshotPath(root, label), canonicalSnapshotPath(target, label))) {
        throw configValidationError(`${label} 的父级符号链接或目录联接不得指向所属目录之外`);
      }
      return target;
    }
    throw configValidationError(`${label} 对应的${directory ? '目录' : '文件'}必须存在`);
  }
  if (directory && !stats.isDirectory()) throw configValidationError(`${label} 必须指向目录，不能是普通文件`);
  if (!directory && !stats.isFile()) throw configValidationError(`${label} 必须指向配置文件，不能是目录`);
  if (!isWithin(realpathSync(root), resolved)) {
    throw configValidationError(`${label} 的符号链接或目录联接不得指向所属目录之外`);
  }
  return target;
}

function readDocument(root, configPath, options) {
  if (!options.readDocument) return readConfigurationDocument(configPath);
  const relative = path.relative(root, configPath).replaceAll('\\', '/');
  const snapshot = options.readDocument(relative);
  try {
    return typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  } catch (error) {
    throw configurationError('config/snapshot-read-failed', `无法解析配置快照：${relative}。`, { cause: error });
  }
}

function validateExceptions(config, { allowExpiredExceptions = false, now = new Date() }) {
  if (!allowExpiredExceptions) assertExceptionLifecycleCurrent(config.repository.exceptions, { now });
  return config;
}

function scopeProjectExceptions(config, repositoryRoot, applicationRoot) {
  const relativeRoot = path.relative(repositoryRoot, applicationRoot).replaceAll('\\', '/');
  if (!relativeRoot) return config;
  const prefix = `${relativeRoot}/`;
  return {
    ...config,
    repository: {
      ...config.repository,
      exceptions: {
        ...config.repository.exceptions,
        entries: config.repository.exceptions.entries.filter((entry) => entry.path.startsWith(prefix))
          .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) })),
      },
    },
  };
}

function readWorkspaceProjects(root, document, options) {
  assertKnownProperties(document, new Set(['$schema', 'version', 'projects', 'repository', 'reporting', 'ci']), CONFIG_FILE);
  if (!Array.isArray(document.projects) || document.projects.length === 0) {
    throw configValidationError('projects 必须包含至少一个显式项目');
  }
  const ids = new Set();
  const roots = [];
  return document.projects.map((entry, index) => {
    const label = `projects[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw configValidationError(`${label} 必须是对象`);
    assertKnownProperties(entry, new Set(['id', 'root', 'config']), label);
    if (typeof entry.id !== 'string' || ids.has(entry.id)) throw configValidationError(`${label}.id 必须是唯一的项目标识`);
    ids.add(entry.id);
    const appRoot = resolveOwnedPath(root, entry.root, `${label}.root`, { directory: true, snapshot: Boolean(options.readDocument) });
    let canonicalRoot;
    try {
      canonicalRoot = realpathSync(appRoot);
    } catch (error) {
      if (!options.readDocument || error.code !== 'ENOENT') throw configValidationError(`${label}.root 无法解析真实目录`);
      canonicalRoot = canonicalSnapshotPath(appRoot, label);
    }
    if (roots.some((existing) => isWithin(existing, canonicalRoot) || isWithin(canonicalRoot, existing))) {
      throw configValidationError(`${label}.root 与其他应用目录重叠；每个文件必须只有一个应用归属`);
    }
    roots.push(canonicalRoot);
    const configPath = resolveOwnedPath(appRoot, entry.config ?? CONFIG_FILE, `${label}.config`, { snapshot: Boolean(options.readDocument) });
    if (path.resolve(configPath) === path.join(root, CONFIG_FILE)) throw configValidationError('子应用配置不得引用工作区入口自身');
    const sharedConfig = validateExceptions(normalizeProjectDocument(readDocument(root, configPath, options), {
      ...options,
      configPath,
      repository: document.repository ?? {},
      reporting: document.reporting ?? {},
      ci: document.ci ?? {},
    }), options);
    const config = scopeProjectExceptions(sharedConfig, root, appRoot);
    if (entry.id !== config.project.id) throw configValidationError(`${label}.id 必须与子应用 project.id 保持一致`);
    return { id: entry.id, root: appRoot, relativeRoot: entry.root, configPath, config, project: config.project };
  });
}

/** 读取显式应用清单；不会扫描目录猜测项目类型。 */
export function loadWorkspace(root, options = {}) {
  try {
    const repositoryRoot = path.resolve(root);
    const configPath = path.join(repositoryRoot, CONFIG_FILE);
    const document = readDocument(repositoryRoot, configPath, options);
    assertProjectDocumentVersion(document);
    if (Object.hasOwn(document, 'projects')) {
      const projects = readWorkspaceProjects(repositoryRoot, document, options);
      const repositoryConfig = validateExceptions(normalizeRepositoryDocument(document), options);
      return { root: repositoryRoot, configPath, document, repositoryConfig, projects };
    }
    const config = validateExceptions(normalizeProjectDocument(document, options), options);
    return {
      root: repositoryRoot, configPath, document, repositoryConfig: config,
      projects: [{ id: config.project.id, root: repositoryRoot, relativeRoot: '.', configPath, config, project: config.project }],
    };
  } catch (error) {
    throw toRepoGuardError(error, { kind: 'configuration', code: 'config/invalid' });
  }
}
