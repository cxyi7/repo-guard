import path from 'node:path';
import { JAVA_ENGINEERING_DEFAULTS, validateJavaEngineeringChecks } from './java-engineering.js';
import { JAVA_ENGINEERING_SCHEMA_PROPERTIES } from './java-engineering-schema.js';
import { assertKnownProperties, configValidationError, normalizeRelativePattern } from './validation-primitives.js';

const baseline = JAVA_ENGINEERING_SCHEMA_PROPERTIES.javaTest;
export const PIT_SCOPE_LIMITS = Object.freeze({ patterns: 32, patternLength: 256, totalPatternLength: 2048, classNameLength: 1024, matchingSteps: 16000000 });
const classPatterns = { type: 'array', minItems: 1, maxItems: PIT_SCOPE_LIMITS.patterns, uniqueItems: true, items: { type: 'string', maxLength: PIT_SCOPE_LIMITS.patternLength, pattern: '^[A-Za-z_$*][A-Za-z0-9_.$*]*$' } };
const allowedArgument = '^(?:-P[A-Za-z0-9_,.-]+|-D(?:maven\\.repo\\.local|repoGuard\\.[A-Za-z0-9_.-]+)=[A-Za-z0-9_.,:/@+-]+)$';
export const JAVA_MUTATION_DEFAULTS = Object.freeze({
  javaMutationTest: Object.freeze({ ...JAVA_ENGINEERING_DEFAULTS.javaTest, timeoutMs: 600000, pluginVersion: '', threshold: 80 }),
});
export const JAVA_MUTATION_SCHEMA_PROPERTIES = Object.freeze({
  javaMutationTest: {
    ...baseline,
    allOf: [{
      if: { properties: { enabled: { const: true } }, required: ['enabled'] },
      then: { required: ['modules', 'pluginVersion'], properties: { modules: { minItems: 1 }, pluginVersion: { pattern: '^1\\.[0-9]+\\.[0-9]+$' } } },
    }],
    properties: {
      ...baseline.properties,
      arguments: { ...baseline.properties.arguments, items: { type: 'string', pattern: allowedArgument } },
      timeoutMs: { ...baseline.properties.timeoutMs, default: 600000 },
      pluginVersion: { type: 'string', pattern: '^(?:|1\\.[0-9]+\\.[0-9]+)$' },
      threshold: { type: 'number', minimum: 0, maximum: 100, default: 80 },
      modules: { type: 'array', items: {
        ...baseline.properties.modules.items,
        required: ['name', 'reports', 'mutationReport', 'targetClasses', 'targetTests'],
        properties: {
          ...baseline.properties.modules.items.properties,
          mutationReport: { type: 'string', minLength: 1 },
          targetClasses: classPatterns,
          targetTests: classPatterns,
        },
      } },
    },
  },
});

function fail(message) { throw configValidationError(`Java 变异测试配置 checks.javaMutationTest ${message}`); }
function patterns(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== 'string' || !/^[A-Za-z_$*][A-Za-z0-9_.$*]*$/.test(entry)) || new Set(value).size !== value.length) {
    fail(`${label} 必须是无重复的 Java 类名模式数组，仅支持字母、数字、点、下划线、美元符和星号`);
  }
  if (value.length > PIT_SCOPE_LIMITS.patterns || value.some((entry) => entry.length > PIT_SCOPE_LIMITS.patternLength) || value.reduce((total, entry) => total + entry.length, 0) > PIT_SCOPE_LIMITS.totalPatternLength) fail(`${label} 最多 32 个模式，每个不超过 256 字符，总长度不超过 2048 字符`);
  return [...value];
}
function normalizeModule(module, index) {
  const label = `modules[${index}]`;
  if (!module || typeof module !== 'object' || Array.isArray(module)) fail(`${label} 必须是对象`);
  assertKnownProperties(module, new Set(Object.keys(JAVA_MUTATION_SCHEMA_PROPERTIES.javaMutationTest.properties.modules.items.properties)), label);
  const mutationReport = normalizeRelativePattern(module.mutationReport, `${label}.mutationReport`);
  const directory = normalizeRelativePattern(module.directory ?? '.', `${label}.directory`);
  const prefix = directory === '.' ? '' : `${directory}/`;
  if (!mutationReport.endsWith('/mutations.xml') || /[*?{}[\]\0]/.test(mutationReport)
      || ![`${prefix}target/`, `${prefix}reports/`].some((entry) => mutationReport.startsWith(entry))) {
    fail(`${label}.mutationReport 必须是所属模块 target/ 或 reports/ 内具体的 mutations.xml 路径`);
  }
  return { ...module, directory, mutationReport, targetClasses: patterns(module.targetClasses, `${label}.targetClasses`), targetTests: patterns(module.targetTests, `${label}.targetTests`) };
}
export function mutationEffectivePomPath(module) {
  return path.posix.join(module.directory, 'target/repo-guard-pit-effective-pom.xml');
}
export function mutationBoundaryConfig(config) {
  return { ...config, modules: config.modules.map((module) => ({
    name: module.name, directory: module.directory,
    reports: [...module.reports, module.mutationReport, mutationEffectivePomPath(module)],
  })) };
}
export function validateJavaMutationChecks(checks, { configPath = 'repo-guard.config.json' } = {}) {
  const value = checks.javaMutationTest === undefined ? {} : checks.javaMutationTest;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('必须是对象');
  assertKnownProperties(value, new Set(Object.keys(JAVA_MUTATION_SCHEMA_PROPERTIES.javaMutationTest.properties)), `${configPath} checks.javaMutationTest`);
  const result = { ...JAVA_MUTATION_DEFAULTS.javaMutationTest, ...value };
  if (!Array.isArray(result.modules)) fail('modules 必须是数组');
  const modules = result.modules.map(normalizeModule);
  const common = validateJavaEngineeringChecks({ javaTest: Object.fromEntries(
    Object.keys(baseline.properties).map((key) => [key, key === 'modules'
      ? modules.map(({ name, directory, reports }) => ({ name, directory, reports })) : result[key]]),
  ) }, { configPath, featureNames: { javaTest: 'javaMutationTest' } }).javaTest;
  if (typeof result.pluginVersion !== 'string' || !/^(?:|1\.\d+\.\d+)$/.test(result.pluginVersion) || (common.enabled && !result.pluginVersion)) {
    fail('pluginVersion 启用时必须指定 PIT 1.x 的固定正式版本，不接受快照、范围或动态版本');
  }
  if (typeof result.threshold !== 'number' || !Number.isFinite(result.threshold) || result.threshold < 0 || result.threshold > 100) fail('threshold 必须介于 0 到 100');
  if (common.arguments.some((argument) => !new RegExp(allowedArgument).test(argument))) {
    fail('arguments 仅允许 -P、-Dmaven.repo.local 和 -DrepoGuard.<自定义名称>，不得直接注入 PIT 工具属性');
  }
  const normalized = { ...result, ...common, modules: modules.map((module, index) => ({ ...module, ...common.modules[index] })) };
  const paths = mutationBoundaryConfig(normalized).modules.flatMap((module) => module.reports);
  if (new Set(paths.map((entry) => process.platform === 'win32' ? entry.toLowerCase() : entry)).size !== paths.length) fail('基线报告、变异报告和有效 POM 路径不得重复');
  return { javaMutationTest: normalized };
}
