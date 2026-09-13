import { isDeepStrictEqual } from 'node:util';
import { assertKnownProperties, configValidationError } from './validation-primitives.js';

const idPattern = /^[a-z][a-zA-Z0-9-]*$/;
const reference = /\$\{([a-z][a-zA-Z0-9-]*)\}/g;
const independentFields = new WeakMap();
const referenceTemplates = new WeakMap();
const targets = {
  sourceSecurity: ['include', 'exclude'],
  filePlacement: ['rules'], maxFileLines: ['rules', 'exclusions'],
  fileHeader: ['include', 'exclude'], functionDocs: ['include', 'exclude'],
  pathNaming: ['include', 'exclude'], asyncResourceCleanup: ['include', 'exclude'],
  unitTest: ['sourcePatterns', 'testPatterns', 'mappings', 'exclusions'],
  coverage: ['reportsDirectory'], mutationTest: ['options.mutate', 'configFile', 'reportsDirectory'],
  architecture: ['sourcePaths', 'exclude', 'rules', 'tsConfig'],
  deadCode: ['options.entry', 'options.project', 'options.ignoreFiles', 'configFile', 'baselineFile'],
  stylelint: ['pattern', 'options.ignoreFiles', 'options.overrides', 'uiTokens.include', 'uiTokens.exclude', 'uiTokens.manifestFile', 'uiTokens.values.definitions', 'governance.allowedGlobalStylePatterns'],
  eslint: ['pattern', 'options.ignores'], prettier: ['pattern'],
  typeCheck: ['options.configFiles'], build: ['artifactBudget.outputDirectory', 'options.artifacts.outputDirectory', 'options.artifacts.manifestFile', 'options.bundleAnalysis.reportFile'],
  lighthouse: ['configFile', 'options.imageAudits.sourceRoots'],
  imageAssets: ['include', 'exclude', 'duplicates.canonicalRoots'],
  unusedImageAssets: ['sourceInclude', 'sourceExclude', 'aliases', 'publicRoots', 'dynamicReferences'],
};
for (const name of ['javaFormat', 'javaNaming', 'javaLayout', 'javaImports', 'javaSize', 'javaDocs', 'javaLint', 'javaDuplication']) targets[name] = ['include', 'exclude', 'args'];
for (const name of ['javaArchitecture', 'javaDependencies', 'javaCompile', 'javaBuild', 'javaTest', 'javaCoverage', 'javaSpotbugs', 'javaMutationTest']) targets[name] = ['modules', 'pom'];
targets.javaFiles = ['allowedJavaRoots', 'forbidden'];
targets.javaPathNaming = ['include', 'exclude', 'rules'];
export const DIRECTORY_BINDING_TARGETS = Object.freeze(Object.entries(targets).flatMap(([check, fields]) => fields.map((field) => `checks.${check}.${field}`)));
export const directoryFieldValue = (value, target) => target.split('.').reduce((current, key) => current?.[key], value);
export function carryDirectoryBindingState(source, target) {
  if (independentFields.has(source)) independentFields.set(target, independentFields.get(source));
  if (referenceTemplates.has(source)) referenceTemplates.set(target, referenceTemplates.get(source));
  return target;
}

function assignField(value, parts, next, remove = false) {
  const [key, ...rest] = parts;
  if (!rest.length) {
    if (remove) delete value[key];
    else value[key] = next;
    return;
  }
  if (Object.hasOwn(value, key)) object(value[key], parts.join('.'));
  value[key] = { ...value[key] };
  assignField(value[key], rest, next, remove);
}

function fail(message) { throw configValidationError(`目录配置 directories 无效：${message}`); }
function object(value, label, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`);
  if (fields) assertKnownProperties(value, new Set(fields), `directories.${label}`);
}
function text(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\r\n\0]/.test(value)) fail(`${label} 必须是单行非空文本，长度不超过 ${limit}`);
}
function directoryPath(value) {
  // 目录是字面路径，不是 glob；点在正则绑定中单独转义。
  if (value === '.') return value;
  if (!value || value.length > 1024 || /[^\p{L}\p{N} _./-]/u.test(value)
    || value.split('/').some((part) => !part || part === '.' || part === '..' || part.trim() !== part)) fail('path 必须是应用内相对目录，不能包含通配符、绝对路径、越界段或控制字符');
  return value;
}

export function validateDirectoryRoles(value) {
  if (value === undefined) return undefined;
  object(value, '', ['entries', 'bindings']);
  object(value.entries, 'entries');
  object(value.bindings === undefined ? {} : value.bindings, 'bindings');
  if (Object.keys(value.entries).length > 64 || Object.keys(value.bindings ?? {}).length > 128) fail('目录最多 64 项，绑定最多 128 项');
  for (const [id, entry] of Object.entries(value.entries)) {
    if (!idPattern.test(id) || ['constructor', 'prototype', '__proto__'].includes(id)) fail('职责标识必须以小写字母开头，只含字母、数字或连字符');
    object(entry, `entries.${id}`, ['path', 'purpose']);
    text(entry.path, `${id}.path`, 1024);
    text(entry.purpose, `${id}.purpose`, 1000);
  }
  const result = { entries: structuredClone(value.entries), bindings: structuredClone(value.bindings ?? {}) };
  const paths = resolveDirectoryPaths(result);
  for (const [target, binding] of Object.entries(result.bindings)) {
    if (!DIRECTORY_BINDING_TARGETS.includes(target)) fail(`不允许绑定字段 ${target}`);
    object(binding, `bindings.${target}`, ['format', 'value']);
    if (!['path', 'glob', 'regex'].includes(binding.format)) fail(`${target}.format 只能为 path、glob 或 regex`);
    if (!Object.hasOwn(binding, 'value')) fail(`${target}.value 必须提供模板`);
    expandDirectoryBinding(binding, paths);
  }
  return result;
}

export function resolveDirectoryPaths(directories) {
  const resolved = Object.create(null);
  const active = new Set();
  const resolve = (id) => {
    if (Object.hasOwn(resolved, id)) return resolved[id];
    if (!Object.hasOwn(directories.entries, id)) fail(`引用了未登记的职责 ${id}`);
    if (active.has(id)) fail(`目录引用形成循环：${[...active, id].join(' → ')}`);
    active.add(id);
    const path = directories.entries[id].path.replace(reference, (_, parent) => resolve(parent));
    if (path.includes('${')) fail(`${id}.path 包含无效引用`);
    resolved[id] = directoryPath(path);
    active.delete(id);
    return resolved[id];
  };
  for (const id of Object.keys(directories.entries)) resolve(id);
  return resolved;
}

export function expandDirectoryBinding(binding, paths) {
  let nodes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 10000 || depth > 20) fail('绑定模板过大或嵌套过深');
    if (typeof value === 'string') {
      if (value.length > 10000) fail('绑定文本过长');
      const expanded = value.replace(reference, (_, id) => {
        if (!Object.hasOwn(paths, id)) fail(`绑定引用了未登记的职责 ${id}`);
        return binding.format === 'regex' ? paths[id].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : paths[id];
      });
      if (expanded.includes('${')) fail('绑定包含无效引用');
      return expanded;
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    object(value, '绑定模板');
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('绑定模板包含不安全属性');
      return [key, visit(item, depth + 1)];
    }));
  };
  return visit(binding.value);
}

/** 缺省字段使用目录绑定；用户显式路径优先，显式引用仍按所声明格式解析。 */
export function applyDirectoryBindings(value, directories, { preset = false } = {}) {
  if (!directories) return value;
  if (value.checks !== undefined) object(value.checks, 'checks');
  const checks = { ...value.checks };
  const independent = new Set();
  const templates = new Map();
  const previous = independentFields.get(value);
  for (const target of DIRECTORY_BINDING_TARGETS) {
    const field = directoryFieldValue(value, target);
    if (field !== undefined && JSON.stringify(field).includes('${') && !Object.hasOwn(directories.bindings, target)) fail(`${target} 使用目录引用时必须声明绑定格式`);
  }
  const paths = resolveDirectoryPaths(directories);
  for (const [target, binding] of Object.entries(directories.bindings)) {
    const explicit = directoryFieldValue(value, target);
    const priorTemplate = referenceTemplates.get(value)?.get(target);
    if (!preset && priorTemplate !== undefined
      && isDeepStrictEqual(explicit, expandDirectoryBinding({ ...binding, value: priorTemplate }, paths))) {
      templates.set(target, priorTemplate);
      continue;
    }
    if (!preset && explicit !== undefined && !JSON.stringify(explicit).includes('${')) {
      if (!previous || previous.has(target) || !isDeepStrictEqual(explicit, expandDirectoryBinding(binding, paths))) independent.add(target);
      continue;
    }
    const chosen = !preset && explicit !== undefined ? { ...binding, value: explicit } : binding;
    if (!preset && explicit !== undefined) templates.set(target, structuredClone(explicit));
    assignField(checks, target.split('.').slice(1), expandDirectoryBinding(chosen, paths));
  }
  const result = { ...value, checks };
  independentFields.set(result, independent);
  referenceTemplates.set(result, templates);
  return result;
}

/** 写回绑定模板本身，防止目录改名后残留旧的派生路径。 */
export function removeDerivedDirectoryFields(document, origin = document) {
  if (!document.directories) return document;
  const result = structuredClone(document);
  const paths = resolveDirectoryPaths(result.directories);
  for (const [target, binding] of Object.entries(result.directories.bindings)) {
    const template = referenceTemplates.get(origin)?.get(target);
    if (template !== undefined && isDeepStrictEqual(directoryFieldValue(result, target),
      expandDirectoryBinding({ ...binding, value: template }, paths))) {
      assignField(result, target.split('.'), structuredClone(template));
      continue;
    }
    if (independentFields.get(origin)?.has(target)) continue;
    if (!isDeepStrictEqual(directoryFieldValue(result, target), expandDirectoryBinding(binding, paths))) continue;
    // Schema 必填字段保留引用模板，其余派生字段省略；独立用户值保留。
    const required = target === 'checks.mutationTest.options.mutate' || target.endsWith('.modules');
    assignField(result, target.split('.'), required ? structuredClone(binding.value) : undefined, !required);
  }
  return result;
}

/** 开关命令补齐默认选项时，不把已绑定字段重新写成旧预设的字面路径。 */
export function preserveDirectoryBindings(document, previous, feature) {
  if (!previous.directories) return document;
  const result = structuredClone(document);
  for (const target of Object.keys(previous.directories.bindings ?? {})) {
    if (target.startsWith(`checks.${feature}.`) && directoryFieldValue(previous, target) === undefined) {
      assignField(result, target.split('.'), undefined, true);
    }
  }
  return result;
}
