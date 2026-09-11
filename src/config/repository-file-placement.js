import { normalizeFilePlacementRule } from './file-placement-validation.js';
import { assertKnownProperties, configValidationError, CONFIG_FILE } from './validation-primitives.js';

export const DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG = Object.freeze({ enabled: false, rules: Object.freeze([]) });

const patterns = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
export const REPOSITORY_FILE_PLACEMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  description: '仓库级文件归位规则，只在根配置维护；所有路径相对仓库根目录，不继承到子应用。按声明顺序采用第一条匹配规则。',
  properties: {
    enabled: { type: 'boolean', default: false, description: '是否启用仓库级文件归位；启用前必须至少配置一条规则。' },
    rules: {
      type: 'array', default: [], description: '有序规则列表；关闭时可为空，第一条匹配规则决定文件应放置的位置。',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'patterns', 'allowedPatterns', 'suggestedDirectory'],
        properties: {
          name: { type: 'string', minLength: 1, description: '非空规则名称，用于中文违规提示。' },
          patterns: { ...patterns, description: '匹配需要限制位置的仓库相对文件路径。' },
          allowedPatterns: { ...patterns, description: '匹配文件允许所在的位置，路径相对仓库根目录。' },
          exceptions: { ...patterns, minItems: 0, default: [], description: '当前规则明确放行的路径；不能为 null。' },
          suggestedDirectory: { type: 'string', minLength: 1, description: '建议移动到的仓库内具体目录，不支持通配符。' },
        },
      },
    },
  },
  allOf: [{
    if: { properties: { enabled: { const: true } }, required: ['enabled'] },
    then: { required: ['rules'], properties: { rules: { type: 'array', minItems: 1 } } },
  }],
});

export function validateRepositoryFilePlacementConfiguration(repositoryValue = {}, configPath = CONFIG_FILE) {
  const label = `${configPath} repository.filePlacement`;
  if (!repositoryValue || typeof repositoryValue !== 'object' || Array.isArray(repositoryValue)) throw configValidationError(`${configPath} repository 必须是对象`);
  const value = repositoryValue.filePlacement === undefined ? {} : repositoryValue.filePlacement;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw configValidationError(`${label} 必须是对象`);
  assertKnownProperties(value, new Set(['enabled', 'rules']), label);
  const enabled = value.enabled === undefined ? DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG.enabled : value.enabled;
  if (typeof enabled !== 'boolean') throw configValidationError(`${label}.enabled 必须是布尔值`);
  const rules = value.rules === undefined ? DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG.rules : value.rules;
  if (!Array.isArray(rules) || (enabled && !rules.length)) throw configValidationError(`${label}.rules 必须是数组，启用时至少配置一条规则`);
  return {
    enabled,
    rules: rules.map((rule, index) => {
      if (rule && typeof rule === 'object' && rule.exceptions === null) throw configValidationError(`${label} 规则 ${index + 1}.exceptions 必须是数组，不能为 null`);
      return normalizeFilePlacementRule(rule, index, configPath, { configLabel: 'repository.filePlacement' });
    }),
  };
}
