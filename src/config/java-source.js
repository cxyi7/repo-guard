import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
} from './validation-primitives.js';

const COMMON_DEFAULTS = Object.freeze({
  enabled: false,
  command: null,
  args: Object.freeze([]),
  timeoutMs: 120000,
  include: Object.freeze(['**/*.java']),
  exclude: Object.freeze(['**/target/**', '**/build/**']),
});

export const JAVA_SOURCE_DEFAULTS = Object.freeze({
  javaFormat: Object.freeze({ ...COMMON_DEFAULTS, style: 'google' }),
  javaNaming: COMMON_DEFAULTS,
  javaLayout: COMMON_DEFAULTS,
  javaImports: COMMON_DEFAULTS,
  javaSize: Object.freeze({
    ...COMMON_DEFAULTS,
    maxFileLines: 1000,
    maxMethodLines: 100,
    maxParameters: 7,
    maxCyclomaticComplexity: 15,
    maxNestingDepth: 3,
  }),
  javaDocs: Object.freeze({ ...COMMON_DEFAULTS, scope: 'public' }),
  javaLint: COMMON_DEFAULTS,
  javaDuplication: Object.freeze({ ...COMMON_DEFAULTS, minimumTokens: 100 }),
});

const OWN_FIELDS = Object.freeze({
  javaFormat: ['style'],
  javaSize: [
    'maxFileLines', 'maxMethodLines', 'maxParameters',
    'maxCyclomaticComplexity', 'maxNestingDepth',
  ],
  javaDocs: ['scope'],
  javaDuplication: ['minimumTokens'],
});

// 这里只允许启动工具的前缀参数；源文件、规则和报告参数由原生适配器管理。
const MANAGED_ARGUMENT = /^(?:@|--?$|--?(?:config|rulesets?|format|report-file|file-list|dir|uri|exclude|ignore|suppress|show-suppressed|minimum-tokens|no-fail|fail-on|no-cache|cache|language|use-version|dry-run|replace|set-exit|skip|help|version|aosp|assume-filename|lines|offset|length|stdin|output|debug|execute|property|properties|threads|progress)(?:$|[-=])|-[cRfrodDxVh](?:$|=))/;

function normalizeTool(value, label) {
  const command = value.command;
  if (command !== null && (
    typeof command !== 'string' || !command.trim() || /[\r\n\0]/.test(command)
  )) throw configValidationError(`${label}.command 必须为 null 或不含换行的非空可执行文件名称或路径`);
  if (value.enabled && command === null) {
    throw configValidationError(`${label}.command 在启用检查时必须显式指定已准备的工具`);
  }
  if (!Array.isArray(value.args) || value.args.some((argument) => (
    typeof argument !== 'string' || !argument || /[\r\n\0]/.test(argument)
      || MANAGED_ARGUMENT.test(argument)
  ))) throw configValidationError(`${label}.args 必须仅包含工具启动前缀，不能设置文件、规则、报告、跳过或修复参数`);
  return { command: command?.trim() ?? null, args: [...value.args] };
}

function normalizeFeature(feature, input, configPath) {
  const label = `${configPath} checks.${feature}`;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  const defaults = JAVA_SOURCE_DEFAULTS[feature];
  assertKnownProperties(input, new Set(Object.keys(defaults)), label);
  const value = { ...defaults, ...input };
  if (typeof value.enabled !== 'boolean') throw configValidationError(`${label}.enabled 必须是布尔值`);
  for (const field of ['timeoutMs', ...(OWN_FIELDS[feature] ?? []).filter((key) => !['style', 'scope'].includes(key))]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > 2147483647) {
      throw configValidationError(`${label}.${field} 必须是 1 至 2147483647 的整数`);
    }
  }
  if (feature === 'javaFormat' && !['google', 'aosp'].includes(value.style)) {
    throw configValidationError(`${label}.style 只能为 google 或 aosp`);
  }
  if (feature === 'javaDocs' && !['public', 'protected', 'package', 'private'].includes(value.scope)) {
    throw configValidationError(`${label}.scope 只能为 public、protected、package 或 private`);
  }
  return {
    ...value,
    ...normalizeTool(value, label),
    include: normalizePatternList(value.include, `${label}.include`),
    exclude: normalizePatternList(value.exclude, `${label}.exclude`, { allowEmpty: true }),
  };
}

/** 返回八个独立的 Java 源码配置；项目适用性由项目配置层统一判断。 */
export function validateJavaSourceChecks(checks = {}, { configPath = 'repo-guard.config.json' } = {}) {
  return Object.fromEntries(Object.keys(JAVA_SOURCE_DEFAULTS).map((feature) => [
    feature, normalizeFeature(feature, checks[feature] === undefined ? {} : checks[feature], configPath),
  ]));
}
