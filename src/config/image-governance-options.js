import { IMAGE_GOVERNANCE_DEFAULTS } from '../profiles/frontend-image-defaults.js';
import { configValidationError, normalizePatternList } from './validation-primitives.js';
import { toolOptionShapeValid } from './tool-options-schema.js';

const action = { enum: ['report', 'error'] };
const integer = { type: 'integer', minimum: 1, maximum: 1000000000 };
const patterns = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
const object = (properties) => ({ type: 'object', additionalProperties: false, properties });
const common = { enabled: { type: 'boolean' }, action };
export const IMAGE_GOVERNANCE_SCHEMA = object({
  budgets: object({ ...common, maxBytes: integer, maxWidth: integer, maxHeight: integer,
    rules: { type: 'array', items: { ...object({ name: { type: 'string', minLength: 1 }, patterns, maxBytes: integer, maxWidth: integer, maxHeight: integer }), required: ['name', 'patterns'] } } }),
  formats: object({ ...common, discouraged: patterns }),
  metadata: object(common),
  animation: object({ ...common, maxBytes: integer, maxFrames: integer, maxDurationMs: integer }),
  avif: object({ ...common, quality: { type: 'integer', minimum: 1, maximum: 100 }, effort: { type: 'integer', minimum: 0, maximum: 9 }, minSavingsBytes: integer, minSavingsPercent: { type: 'integer', minimum: 1, maximum: 99 } }),
});



/** 统一验证图片治理扩展，未启用的项目不隐式增加分析。 */
export function validateImageGovernance(value, label) {
  if (value === undefined) return {};
  if (!toolOptionShapeValid(value, IMAGE_GOVERNANCE_SCHEMA)) throw configValidationError(`${label} 包含无效字段或选项值`);
  const result = Object.fromEntries(Object.entries(IMAGE_GOVERNANCE_DEFAULTS).map(([key, defaults]) => [key, { ...structuredClone(defaults), ...value[key] }]));
  result.budgets.rules = result.budgets.rules.map((rule) => ({ ...rule, patterns: normalizePatternList(rule.patterns, `${label}.budgets.rules`) }));
  if (result.formats.discouraged.some((format) => !['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'gif', 'ico', 'bmp', 'tif', 'tiff'].includes(format))) throw configValidationError(`${label}.formats.discouraged 包含未知图片格式`);
  return { governance: result };
}
