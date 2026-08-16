import { configurationError } from '../../core/error/repo-guard-error.js';

const COMMON_FILES = Object.freeze([
  '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}',
]);
const VUE_FILES = Object.freeze(['**/*.vue']);
const TYPESCRIPT_FILES = Object.freeze(['**/*.{ts,mts,cts,tsx,vue}']);

function presetConfigs(value, label) {
  if (!value || (typeof value !== 'object' && !Array.isArray(value))) {
    throw configurationError('eslint/preset-config-missing', `repo-guard ESLint 预设要求安装 ${label}`);
  }
  return Array.isArray(value) ? value : [value];
}

function optionalJsRecommended(js) {
  if (!js) {
    return [];
  }
  return presetConfigs(js.configs?.recommended, '@eslint/js configs.recommended');
}

function optionalVueRecommended(vue) {
  if (!vue) {
    return [];
  }
  const recommended = vue.configs?.['flat/recommended-error']
    ?? vue.configs?.['flat/recommended'];
  return presetConfigs(
    recommended,
    'eslint-plugin-vue configs["flat/recommended-error"] or configs["flat/recommended"]',
  );
}

function optionalTypeScriptRecommended(typescript) {
  if (!typescript) {
    return [];
  }
  return [
    ...presetConfigs(
      typescript.configs?.recommended,
      'typescript-eslint configs.recommended',
    ),
    ...presetConfigs(
      typescript.configs?.stylistic,
      'typescript-eslint configs.stylistic',
    ),
  ];
}

function commonPolicy() {
  return {
    name: 'repo-guard/ai-maintainability',
    files: [...COMMON_FILES],
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
    rules: {
      complexity: ['error', 15],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', {
        max: 120,
        skipBlankLines: true,
        skipComments: true,
      }],
      'max-nested-callbacks': ['error', 4],
      'max-params': ['error', 5],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-var': 'error',
      'no-warning-comments': ['error', {
        terms: ['todo', 'fixme', 'hack'],
        location: 'anywhere',
      }],
      'prefer-const': 'error',
    },
  };
}

function vuePolicy(vue, typescript) {
  if (!vue) {
    return [];
  }

  const languageOptions = typescript
    ? { parserOptions: { parser: typescript.parser } }
    : undefined;
  if (typescript && !typescript.parser) {
    throw configurationError('eslint/typescript-parser-missing', 'repo-guard ESLint 预设要求安装 typescript-eslint parser');
  }

  return [{
    name: 'repo-guard/ai-vue',
    files: [...VUE_FILES],
    ...(languageOptions ? { languageOptions } : {}),
    plugins: { vue },
    rules: {
      'vue/component-api-style': ['error', ['script-setup', 'composition']],
      'vue/html-button-has-type': 'error',
      'vue/max-props': ['error', { maxProps: 12 }],
      'vue/max-template-depth': ['error', { maxDepth: 5 }],
      'vue/require-emit-validator': 'error',
    },
  }];
}

function typescriptPolicy(typescript) {
  if (!typescript) {
    return [];
  }
  if (!typescript.plugin) {
    throw configurationError('eslint/typescript-plugin-missing', 'repo-guard ESLint 预设要求安装 typescript-eslint plugin');
  }

  return [{
    name: 'repo-guard/ai-typescript',
    files: [...TYPESCRIPT_FILES],
    plugins: { '@typescript-eslint': typescript.plugin },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }];
}

export function createRepoGuardEslintConfig({
  js = null,
  typescript = null,
  vue = null,
} = {}) {
  return [
    ...optionalJsRecommended(js),
    ...optionalTypeScriptRecommended(typescript),
    ...optionalVueRecommended(vue),
    commonPolicy(),
    ...vuePolicy(vue, typescript),
    ...typescriptPolicy(typescript),
  ];
}
