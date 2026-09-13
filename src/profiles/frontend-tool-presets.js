/** 启用时复制到项目配置；日常执行不补写、不升级已保存规则。 */
export const FRONTEND_ESLINT_OPTIONS = {
  recommended: true,
  typeAware: true,
  ignores: ['**/dist/**', '**/coverage/**', '**/reports/**'],
  globals: { browser: true, node: false },
  linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
  rules: {
    complexity: ['error', 15], curly: ['error', 'all'], eqeqeq: ['error', 'always'],
    'max-depth': ['error', 4],
    'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    'max-nested-callbacks': ['error', 4], 'max-params': ['error', 5],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-debugger': 'error', 'no-eval': 'error', 'no-implied-eval': 'error',
    'no-new-func': 'error', 'no-var': 'error', 'prefer-const': 'error',
    'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'hack'], location: 'anywhere' }],
    'no-alert': 'error', 'no-promise-executor-return': 'error',
    'no-return-assign': ['error', 'always'], 'no-self-compare': 'error',
  },
  vueRules: {
    'vue/component-api-style': ['error', ['script-setup']],
    'vue/html-button-has-type': 'error', 'vue/max-props': ['error', { maxProps: 12 }],
    'vue/max-template-depth': ['error', { maxDepth: 5 }],
    'vue/require-emit-validator': 'error', 'vue/require-explicit-emits': 'error',
    'vue/no-mutating-props': 'error', 'vue/no-side-effects-in-computed-properties': 'error',
    'vue/no-async-in-computed-properties': 'error', 'vue/no-unused-refs': 'error',
    'vue/no-setup-props-reactivity-loss': 'error',
  },
  typescriptRules: {
    'no-unused-vars': 'off', 'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/ban-ts-comment': ['error', {
      'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false,
      'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10,
    }],
    '@typescript-eslint/no-import-type-side-effects': 'error',
  },
  typedRules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
  },
};

export const FRONTEND_PRETTIER_OPTIONS = {
  printWidth: 100, tabWidth: 2, useTabs: false, semi: true, singleQuote: true,
  jsxSingleQuote: false, quoteProps: 'as-needed', trailingComma: 'all',
  bracketSpacing: true, bracketSameLine: false, arrowParens: 'always', endOfLine: 'lf',
  vueIndentScriptAndStyle: false, htmlWhitespaceSensitivity: 'css',
  singleAttributePerLine: false, embeddedLanguageFormatting: 'auto', proseWrap: 'preserve',
};

export const FRONTEND_STYLELINT_OPTIONS = {
  extends: ['stylelint-config-standard'], plugins: ['stylelint-order'],
  ignoreFiles: ['**/dist/**', '**/coverage/**', '**/reports/**'],
  overrides: [{ files: ['**/*.vue'], customSyntax: 'postcss-html' }, { files: ['**/*.css'], rules: { 'selector-max-specificity': '0,3,1' } }],
  rules: {
    'color-no-invalid-hex': true, 'block-no-empty': true,
    'custom-property-no-missing-var-function': true, 'declaration-block-no-duplicate-custom-properties': true,
    'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates-with-different-syntaxes'] }],
    'declaration-block-no-shorthand-property-overrides': true,
    'font-family-no-duplicate-names': true, 'font-family-no-missing-generic-family-keyword': true,
    'keyframe-declaration-no-important': true, 'unit-no-unknown': true,
    'property-no-unknown': true,
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep', 'global', 'slotted'] }],
    'selector-pseudo-element-no-unknown': true, 'at-rule-no-unknown': true,
    'no-invalid-double-slash-comments': true, 'declaration-property-value-no-unknown': true,
    'selector-class-pattern': '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
    'order/properties-alphabetical-order': true,
    'selector-max-compound-selectors': 3, 'max-nesting-depth': 3,
    'selector-max-specificity': null, 'selector-max-id': 0,
    'declaration-no-important': true, 'no-descending-specificity': null,
  },
};

export const FRONTEND_TYPECHECK_OPTIONS = {
  tool: 'vue-tsc', configFiles: ['tsconfig.json'],
  compilerOptions: {
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    noImplicitOverride: true, noFallthroughCasesInSwitch: true,
    forceConsistentCasingInFileNames: true, allowUnreachableCode: false,
    allowUnusedLabels: false, noEmit: true, verbatimModuleSyntax: true,
    isolatedModules: true, noUnusedLocals: false, noUnusedParameters: false,
    skipLibCheck: false,
  },
};

export const FRONTEND_MUTATION_OPTIONS = {
  mutate: ['src/utils/**/*.{js,ts}', '!src/utils/**/*.d.ts', '!src/utils/**/*.types.ts', '!src/utils/**/generated/**', '!src/utils/**/*.{spec,test}.*'],
  testRunner: 'vitest', thresholds: { high: 80, low: 60, break: 80 },
};

export function frontendToolOptions(feature, project) {
  if (project?.role !== 'frontend' || project.stack !== 'node') return undefined;
  const defaults = { mutationTest: FRONTEND_MUTATION_OPTIONS, eslint: FRONTEND_ESLINT_OPTIONS, prettier: FRONTEND_PRETTIER_OPTIONS,
    stylelint: FRONTEND_STYLELINT_OPTIONS, typeCheck: FRONTEND_TYPECHECK_OPTIONS };
  if (!Object.hasOwn(defaults, feature)) return undefined;
  const options = structuredClone(defaults[feature]);
  if (feature === 'eslint' && project.preset !== 'vue-typescript') options.typeAware = false;
  return options;
}
