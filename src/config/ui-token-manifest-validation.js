import { UI_TOKEN_ADAPTERS, UI_TOKEN_CATEGORIES } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizeRelativePattern,
} from './validation-primitives.js';

const TOKEN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function relativeFile(value, label) {
  const normalized = normalizeRelativePattern(value, label);
  if (/[*?{}[\]]/.test(normalized)) {
    throw configValidationError(`${label} 必须是确定文件路径，不得包含 glob`);
  }
  return normalized;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configValidationError(`${label} 必须是非空字符串`);
  }
  return value.trim();
}

function uniqueStringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw configValidationError(`${label} 必须是${allowEmpty ? '' : '非空'}字符串数组`);
  }
  const normalized = value.map((entry, index) => (
    nonEmptyString(entry, `${label} 第 ${index + 1} 项`)
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw configValidationError(`${label} 不得包含重复值`);
  }
  return normalized;
}

function staticUnoToken(value, label) {
  const normalized = nonEmptyString(value, label);
  if (/\s/.test(normalized)) {
    throw configValidationError(`${label} 必须是单个静态 UnoCSS token，不得包含空白字符`);
  }
  return normalized;
}

function unoUtilitySegments(token) {
  const segments = [];
  let current = '';
  let squareDepth = 0;
  let roundDepth = 0;
  for (const character of token) {
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth -= 1;
    if (character === ':' && squareDepth === 0 && roundDepth === 0) {
      segments.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  segments.push(current);
  return segments;
}

function staticUnoBaseToken(value, label) {
  const normalized = staticUnoToken(value, label);
  if (unoUtilitySegments(normalized).length > 1 || normalized.startsWith('!')) {
    throw configValidationError(`${label} 必须是不带 variant 和 ! 前缀的 UnoCSS 基础 token`);
  }
  return normalized;
}

function validateSource(source, index, label) {
  const sourceLabel = `${label} sources 第 ${index + 1} 项`;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw configValidationError(`${sourceLabel} 必须是对象`);
  }
  assertKnownProperties(source, new Set(['path', 'sha256']), sourceLabel);
  const file = relativeFile(source.path, `${sourceLabel}.path`);
  if (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) {
    throw configValidationError(`${sourceLabel}.sha256 必须是小写 SHA-256`);
  }
  return { path: file, sha256: source.sha256 };
}

function validateAliases(value, tokenLabel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${tokenLabel}.aliases 必须是对象`);
  }
  assertKnownProperties(value, new Set(UI_TOKEN_ADAPTERS), `${tokenLabel}.aliases`);
  const aliases = Object.fromEntries(UI_TOKEN_ADAPTERS.map((adapter) => [
    adapter,
    uniqueStringList(
      value[adapter] ?? [],
      `${tokenLabel}.aliases.${adapter}`,
      { allowEmpty: true },
    ).map((alias) => (
      adapter === 'unocss'
        ? staticUnoBaseToken(alias, `${tokenLabel}.aliases.${adapter}`)
        : alias
    )),
  ]));
  if (Object.values(aliases).every((items) => items.length === 0)) {
    throw configValidationError(`${tokenLabel}.aliases 至少要声明一种适配器别名`);
  }
  return aliases;
}

function validateToken(token, index, label) {
  const tokenLabel = `${label} tokens 第 ${index + 1} 项`;
  if (!token || typeof token !== 'object' || Array.isArray(token)) {
    throw configValidationError(`${tokenLabel} 必须是对象`);
  }
  assertKnownProperties(token, new Set(['id', 'category', 'aliases']), tokenLabel);
  const id = nonEmptyString(token.id, `${tokenLabel}.id Token 标识`);
  if (!TOKEN_ID.test(id)) {
    throw configValidationError(`${tokenLabel}.id 必须是小写点号或连字符分段标识`);
  }
  if (!UI_TOKEN_CATEGORIES.includes(token.category)) {
    throw configValidationError(
      `${tokenLabel}.category 必须是以下值之一：${UI_TOKEN_CATEGORIES.join(', ')}`,
    );
  }
  return {
    id,
    category: token.category,
    aliases: validateAliases(token.aliases, tokenLabel),
  };
}

function validateShortcut(shortcut, index, label) {
  const shortcutLabel = `${label} shortcuts 第 ${index + 1} 项`;
  if (!shortcut || typeof shortcut !== 'object' || Array.isArray(shortcut)) {
    throw configValidationError(`${shortcutLabel} 必须是对象`);
  }
  assertKnownProperties(shortcut, new Set(['name', 'expandsTo']), shortcutLabel);
  return {
    name: staticUnoBaseToken(shortcut.name, `${shortcutLabel}.name 快捷方式名称`),
    expandsTo: uniqueStringList(shortcut.expandsTo, `${shortcutLabel}.expandsTo`)
      .map((utility) => staticUnoToken(utility, `${shortcutLabel}.expandsTo`)),
  };
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw configValidationError(`${label} 不得包含重复值`);
  }
}

function unoUtilityBase(token) {
  return unoUtilitySegments(token).at(-1).replace(/^!/, '');
}

function assertAcyclicShortcuts(shortcuts, label) {
  const shortcutMap = new Map(shortcuts.map((shortcut) => [shortcut.name, shortcut]));
  const complete = new Set();
  const visit = (name, active) => {
    if (complete.has(name)) return;
    if (active.has(name)) {
      throw configValidationError(`${label} shortcuts 存在循环展开：${[...active, name].join(' -> ')}`);
    }
    const nextActive = new Set([...active, name]);
    for (const utility of shortcutMap.get(name).expandsTo) {
      const nested = unoUtilityBase(utility);
      if (shortcutMap.has(nested)) visit(nested, nextActive);
    }
    complete.add(name);
  };
  for (const name of shortcutMap.keys()) visit(name, new Set());
}

export function validateUiTokenManifest(value, label = 'UI Token Manifest') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须包含 JSON 对象`);
  }
  assertKnownProperties(
    value,
    new Set(['$schema', 'version', 'sources', 'tokens', 'shortcuts']),
    label,
  );
  if (value.$schema != null && typeof value.$schema !== 'string') {
    throw configValidationError(`${label}.$schema 必须是字符串`);
  }
  if (value.version !== 1) {
    throw configValidationError(`${label} 使用了不支持的版本：${String(value.version)}`);
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw configValidationError(`${label} sources 必须是非空数组`);
  }
  if (!Array.isArray(value.tokens) || value.tokens.length === 0) {
    throw configValidationError(`${label} tokens 必须是非空数组`);
  }
  const sources = value.sources.map((source, index) => validateSource(source, index, label));
  const tokens = value.tokens.map((token, index) => validateToken(token, index, label));
  const shortcuts = (value.shortcuts ?? []).map(
    (shortcut, index) => validateShortcut(shortcut, index, label),
  );
  assertUnique(sources.map(({ path }) => path), `${label} sources.path`);
  assertUnique(tokens.map(({ id }) => id), `${label} tokens.id`);
  assertUnique(shortcuts.map(({ name }) => name), `${label} shortcuts.name`);
  for (const adapter of UI_TOKEN_ADAPTERS) {
    assertUnique(
      tokens.flatMap(({ aliases }) => aliases[adapter]),
      `${label} ${adapter} 别名`,
    );
  }
  const unocssAliases = new Set(tokens.flatMap(({ aliases }) => aliases.unocss));
  const shortcutAliasCollision = shortcuts.find(({ name }) => unocssAliases.has(name));
  if (shortcutAliasCollision) {
    throw configValidationError(
      `${label} shortcut 名称不得与 UnoCSS Token 别名重复：${shortcutAliasCollision.name}`,
    );
  }
  assertAcyclicShortcuts(shortcuts, label);
  return { version: 1, sources, tokens, shortcuts };
}
