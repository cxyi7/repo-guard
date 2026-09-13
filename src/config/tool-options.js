import { assertKnownProperties, configValidationError } from './validation-primitives.js';
import { TOOL_OPTIONS_SCHEMAS, toolOptionShapeValid } from './tool-options-schema.js';

const KEYS = {
  mutationTest: ['mutate', 'testRunner', 'thresholds', 'vitest'],
  eslint: ['recommended', 'typeAware', 'ignores', 'globals', 'linterOptions', 'rules', 'vueRules', 'typescriptRules', 'typedRules'],
  prettier: ['printWidth', 'tabWidth', 'useTabs', 'semi', 'singleQuote', 'jsxSingleQuote', 'quoteProps', 'trailingComma', 'bracketSpacing', 'bracketSameLine', 'arrowParens', 'endOfLine', 'vueIndentScriptAndStyle', 'htmlWhitespaceSensitivity', 'singleAttributePerLine', 'embeddedLanguageFormatting', 'proseWrap'],
  stylelint: ['extends', 'plugins', 'customSyntax', 'ignoreFiles', 'overrides', 'rules', 'defaultSeverity', 'reportDescriptionlessDisables', 'reportInvalidScopeDisables', 'reportNeedlessDisables'],
  typeCheck: ['tool', 'configFiles', 'compilerOptions'],
};

function assertJson(value, label) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((item) => assertJson(item, label)); return; }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw configValidationError(`${label} 包含不允许的属性`);
      assertJson(item, label);
    }
    return;
  }
  throw configValidationError(`${label} 必须只包含 JSON 值`);
}

/** 工具原生规则值交由对应工具校验；外层结构与不安全属性提前拒绝。 */
export function validateToolOptions(feature, value, configPath) {
  if (value === undefined) return {};
  const label = `${configPath} checks.${feature}.options`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw configValidationError(`${label} 必须是对象`);
  assertJson(value, label);
  if (!toolOptionShapeValid(value, TOOL_OPTIONS_SCHEMAS[feature])) throw configValidationError(`${label} 包含无效字段、类型或选项值`);
  assertKnownProperties(value, new Set(KEYS[feature]), label);
  for (const key of ['rules', 'vueRules', 'typescriptRules', 'typedRules', 'compilerOptions', 'globals', 'linterOptions']) {
    if (Object.hasOwn(value, key) && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) {
      throw configValidationError(`${label}.${key} 必须是对象`);
    }
  }
  for (const key of ['recommended', 'typeAware']) {
    if (Object.hasOwn(value, key) && typeof value[key] !== 'boolean') throw configValidationError(`${label}.${key} 必须是布尔值`);
  }
  if (feature === 'mutationTest' && Object.values(value.thresholds).some((threshold) => threshold > 100)) {
    throw configValidationError(`${label}.thresholds 必须介于 0 到 100 之间`);
  }
  if (feature === 'typeCheck') {
    if (!['tsc', 'vue-tsc'].includes(value.tool)) throw configValidationError(`${label}.tool 必须是 tsc 或 vue-tsc`);
    if (!Array.isArray(value.configFiles) || !value.configFiles.length || value.configFiles.some((file) => typeof file !== 'string' || !file.endsWith('.json') || file.startsWith('/') || file.includes('..') || /[:\\]/.test(file))) {
      throw configValidationError(`${label}.configFiles 必须包含应用内的相对 JSON 路径`);
    }
  }
  return { options: structuredClone(value) };
}
