import { JAVA_SOURCE_DEFAULTS } from './java-source.js';

const commonProperties = {
  enabled: { type: 'boolean', default: false, description: '是否启用该 Java 源码检查' },
  command: { type: ['string', 'null'], minLength: 1, default: null, description: '消费项目已经准备的可执行文件名称或路径；启用时必填' },
  args: { type: 'array', items: { type: 'string', minLength: 1 }, default: [], description: '仅用于启动工具的前缀参数；不得覆盖文件、规则、报告或跳过参数' },
  timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647, default: 120000, description: '包括版本确认和检查在内的最长执行时间，单位毫秒' },
  include: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, default: ['**/*.java'], description: '应用根目录内需要检查的 Java 文件范围' },
  exclude: { type: 'array', items: { type: 'string', minLength: 1 }, default: ['**/target/**', '**/build/**'], description: '应用根目录内排除的生成文件范围' },
};
const extraProperties = {
  javaFormat: { style: { enum: ['google', 'aosp'], default: 'google', description: 'google-java-format 的格式风格' } },
  javaSize: Object.fromEntries([
    ['maxFileLines', '单文件最大物理行数'],
    ['maxMethodLines', '单方法最大物理行数，包含空行和注释'],
    ['maxParameters', '方法与构造器的参数上限'],
    ['maxCyclomaticComplexity', '单方法圈复杂度上限'],
    ['maxNestingDepth', '同类 if、for、try 的嵌套深度上限'],
  ].map(([key, description]) => [key, {
    type: 'integer', minimum: 1, maximum: 2147483647, default: JAVA_SOURCE_DEFAULTS.javaSize[key], description,
  }])),
  javaDocs: { scope: { enum: ['public', 'protected', 'package', 'private'], default: 'public', description: '需要 Javadoc 的最低可见性范围' } },
  javaDuplication: { minimumTokens: { type: 'integer', minimum: 1, maximum: 2147483647, default: 100, description: '报告重复代码的最少词法标记数量' } },
};

/** 根 Schema 的 checks.properties 可直接合并本片段。 */
export const JAVA_SOURCE_SCHEMA_PROPERTIES = Object.fromEntries(Object.keys(JAVA_SOURCE_DEFAULTS).map((feature) => [
  feature,
  {
    type: 'object', additionalProperties: false,
    properties: { ...commonProperties, ...extraProperties[feature] },
    allOf: [{
      if: { properties: { enabled: { const: true } }, required: ['enabled'] },
      then: { required: ['command'], properties: { command: { type: 'string', minLength: 1 } } },
    }],
  },
]));
