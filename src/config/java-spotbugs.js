import { JAVA_ENGINEERING_DEFAULTS, validateJavaEngineeringChecks } from './java-engineering.js';
import { JAVA_ENGINEERING_SCHEMA_PROPERTIES } from './java-engineering-schema.js';
import { assertKnownProperties, configValidationError } from './validation-primitives.js';

export const JAVA_SPOTBUGS_DEFAULTS = Object.freeze({
  javaSpotbugs: Object.freeze({
    ...JAVA_ENGINEERING_DEFAULTS.javaTest,
    pluginVersion: '',
    priority: 'normal',
    excludeBugPatterns: [],
  }),
});

const baseSchema = JAVA_ENGINEERING_SCHEMA_PROPERTIES.javaTest;
export const JAVA_SPOTBUGS_SCHEMA_PROPERTIES = {
  javaSpotbugs: {
    ...baseSchema,
    allOf: [{
      if: { properties: { enabled: { const: true } }, required: ['enabled'] },
      then: {
        required: ['modules', 'pluginVersion'],
        properties: {
          modules: { type: 'array', minItems: 1 },
          pluginVersion: { type: 'string', pattern: '^4\\.\\d+\\.\\d+\\.\\d+$' },
        },
      },
    }],
    properties: {
      ...baseSchema.properties,
      arguments: {
        ...baseSchema.properties.arguments,
        items: { type: 'string', pattern: '^(?:-P[A-Za-z0-9_,.-]+|-Dmaven\\.repo\\.local=[A-Za-z0-9_.,:/@+-]+|-DrepoGuard\\.[A-Za-z0-9_.-]+=[A-Za-z0-9_.,:/@+-]+)$' },
      },
      pluginVersion: { type: 'string', pattern: '^(?:|4\\.\\d+\\.\\d+\\.\\d+)$' },
      priority: { enum: ['high', 'normal', 'low'], default: 'normal' },
      excludeBugPatterns: {
        type: 'array', uniqueItems: true,
        items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]+$' },
      },
      modules: {
        ...baseSchema.properties.modules,
        items: {
          ...baseSchema.properties.modules.items,
          properties: {
            ...baseSchema.properties.modules.items.properties,
            reports: { ...baseSchema.properties.modules.items.properties.reports, maxItems: 1 },
          },
        },
      },
    },
  },
};

export function validateJavaSpotbugsChecks(checks, { configPath = 'repo-guard.config.json' } = {}) {
  const value = checks.javaSpotbugs === undefined ? {} : checks.javaSpotbugs;
  const label = `${configPath} checks.javaSpotbugs`;
  const fail = (message) => { throw configValidationError(`${label} ${message}`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('必须是对象');
  assertKnownProperties(value, new Set(Object.keys(JAVA_SPOTBUGS_SCHEMA_PROPERTIES.javaSpotbugs.properties)), label);
  const result = { ...JAVA_SPOTBUGS_DEFAULTS.javaSpotbugs, ...value };
  const { pluginVersion, priority, excludeBugPatterns, ...common } = result;
  const normalized = validateJavaEngineeringChecks({ javaTest: common }, {
    configPath, featureNames: { javaTest: 'javaSpotbugs' },
  }).javaTest;
  if (typeof pluginVersion !== 'string' || (pluginVersion !== '' && !/^4\.\d+\.\d+\.\d+$/.test(pluginVersion))
    || (result.enabled && !pluginVersion)) fail('pluginVersion 必须显式固定为 SpotBugs Maven 插件的 4.x 四段数字版本');
  if (!['high', 'normal', 'low'].includes(priority)) fail('priority 仅允许 high、normal 或 low');
  if (!Array.isArray(excludeBugPatterns) || new Set(excludeBugPatterns).size !== excludeBugPatterns.length
    || excludeBugPatterns.some((item) => typeof item !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(item))) {
    fail('excludeBugPatterns 必须是不重复的原生规则标识数组，不支持通配符');
  }
  if (normalized.arguments.some((item) => !/^(?:-P|-Dmaven\.repo\.local=|-DrepoGuard\.[A-Za-z0-9_.-]+=)/.test(item))) {
    fail('arguments 仅允许显式 profile、maven.repo.local 和 repoGuard.* 项目属性，不得覆盖 SpotBugs 或 Maven 采集参数');
  }
  for (const module of normalized.modules) {
    const prefix = module.directory === '.' ? '' : `${module.directory}/`;
    if (module.reports.length !== 1 || module.reports[0] !== `${prefix}target/spotbugsXml.xml`) {
      fail('每个模块必须声明唯一的 target/spotbugsXml.xml 原生报告，路径相对于当前应用根目录');
    }
  }
  return { javaSpotbugs: { ...normalized, pluginVersion, priority, excludeBugPatterns: [...excludeBugPatterns] } };
}
