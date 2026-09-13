const boolean = { type: 'boolean' };
const object = { type: 'object' };
const strings = { type: 'array', items: { type: 'string', minLength: 1 } };
const enumeration = (...values) => ({ enum: values });
const document = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });

export const TOOL_OPTIONS_SCHEMAS = {
  mutationTest: document({ mutate: { ...strings, minItems: 1 }, testRunner: enumeration('vitest'),
    thresholds: document({ high: { type: 'integer', minimum: 0, maximum: 100 }, low: { type: 'integer', minimum: 0, maximum: 100 }, break: { type: 'integer', minimum: 0, maximum: 100 } }, ['break']),
    vitest: document({ configFile: { type: 'string', minLength: 1 } }) }, ['mutate', 'testRunner', 'thresholds']),
  eslint: document({ recommended: boolean, typeAware: boolean, ignores: strings,
    globals: document({ browser: boolean, node: boolean }), linterOptions: object,
    rules: object, vueRules: object, typescriptRules: object, typedRules: object }),
  prettier: document({ printWidth: { type: 'integer', minimum: 1 }, tabWidth: { type: 'integer', minimum: 1 },
    useTabs: boolean, semi: boolean, singleQuote: boolean, jsxSingleQuote: boolean,
    quoteProps: enumeration('as-needed', 'consistent', 'preserve'), trailingComma: enumeration('all', 'es5', 'none'),
    bracketSpacing: boolean, bracketSameLine: boolean, arrowParens: enumeration('always', 'avoid'),
    endOfLine: enumeration('lf', 'crlf', 'cr', 'auto'), vueIndentScriptAndStyle: boolean,
    htmlWhitespaceSensitivity: enumeration('css', 'strict', 'ignore'), singleAttributePerLine: boolean,
    embeddedLanguageFormatting: enumeration('auto', 'off'), proseWrap: enumeration('preserve', 'always', 'never') }),
  stylelint: document({ extends: strings, plugins: strings, customSyntax: { type: 'string', minLength: 1 },
    ignoreFiles: strings, overrides: { type: 'array', items: object }, rules: object,
    defaultSeverity: enumeration('error', 'warning'), reportDescriptionlessDisables: boolean,
    reportInvalidScopeDisables: boolean, reportNeedlessDisables: boolean }),
  typeCheck: document({ tool: enumeration('tsc', 'vue-tsc'),
    configFiles: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^(?!.*\\.\\.)(?!/)[^:\\\\]+\\.json$' } },
    compilerOptions: object }, ['tool', 'configFiles', 'compilerOptions']),
};

/** 此处只校验以上固定结构；具体原生规则参数继续由对应工具验证。 */
export function toolOptionShapeValid(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
    return Object.entries(value).every(([key, item]) => schema.properties?.[key]
      ? toolOptionShapeValid(item, schema.properties[key]) : schema.additionalProperties !== false);
  }
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.every((item) => toolOptionShapeValid(item, schema.items));
  if (schema.type === 'integer') return Number.isInteger(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0)
    && (!schema.pattern || new RegExp(schema.pattern).test(value));
  return true;
}
