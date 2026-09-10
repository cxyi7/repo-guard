import { UI_TOKEN_LANGUAGES, UI_TOKEN_CATEGORIES } from './defaults.js';
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

const CSS_VARIABLE_ALIAS = /^var\(--[a-zA-Z0-9_-]+\)$/;
const CSS_BREAKPOINT_ALIAS = /^(?!0*(?:\.0+)?(?:px|em|rem)$)(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|em|rem)$/;

function validateCssAlias(alias, category, label) {
  const isBreakpoint = category === 'breakpoint';
  const pattern = isBreakpoint ? CSS_BREAKPOINT_ALIAS : CSS_VARIABLE_ALIAS;
  if (!pattern.test(alias)) {
    throw configValidationError(isBreakpoint
      ? `${label} 的 CSS 断点别名必须是大于零的 px、em 或 rem 长度`
      : `${label} 的 CSS 别名必须是完整 var(--name)，变量名只含字母、数字、下划线或连字符且不得带回退值`);
  }
  return alias;
}

function validateAliases(value, category, tokenLabel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${tokenLabel}.aliases 必须是对象`);
  }
  assertKnownProperties(value, new Set(UI_TOKEN_LANGUAGES), `${tokenLabel}.aliases`);
  const aliases = Object.fromEntries(UI_TOKEN_LANGUAGES.map((language) => [
    language,
    uniqueStringList(
      value[language] === undefined ? [] : value[language],
      `${tokenLabel}.aliases.${language}`,
      { allowEmpty: true },
    ).map((alias) => language === 'css'
      ? validateCssAlias(alias, category, `${tokenLabel}.aliases.css`)
      : alias),
  ]));
  if (Object.values(aliases).every((items) => items.length === 0)) {
    throw configValidationError(`${tokenLabel}.aliases 至少要声明一种语言别名`);
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
    aliases: validateAliases(token.aliases, token.category, tokenLabel),
  };
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw configValidationError(`${label} 不得包含重复值`);
  }
}

export function validateUiTokenManifest(value, label = 'UI Token Manifest') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${label} 必须包含 JSON 对象`);
  }
  assertKnownProperties(
    value,
    new Set(['$schema', 'version', 'sources', 'tokens']),
    label,
  );
  if (value.$schema != null && typeof value.$schema !== 'string') {
    throw configValidationError(`${label}.$schema 必须是字符串`);
  }
  if (value.version !== 2) {
    throw configValidationError(`${label} 仅支持 version: 2，不转换旧格式；当前为 ${String(value.version)}`);
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw configValidationError(`${label} sources 必须是非空数组`);
  }
  if (!Array.isArray(value.tokens) || value.tokens.length === 0) {
    throw configValidationError(`${label} tokens 必须是非空数组`);
  }
  const sources = value.sources.map((source, index) => validateSource(source, index, label));
  const tokens = value.tokens.map((token, index) => validateToken(token, index, label));
  assertUnique(sources.map(({ path }) => path), `${label} sources.path`);
  assertUnique(tokens.map(({ id }) => id), `${label} tokens.id`);
  for (const language of UI_TOKEN_LANGUAGES) {
    assertUnique(
      tokens.flatMap(({ aliases }) => aliases[language]),
      `${label} ${language} 别名`,
    );
  }
  return { version: 2, sources, tokens };
}
