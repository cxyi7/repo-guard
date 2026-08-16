import assert from 'node:assert/strict';
import js from '@eslint/js';
import { ESLint } from 'eslint';
import test from 'node:test';
import { resolveRepoGuardEslintPreset } from '../src/gates/quality/eslint-gate.js';
import { createRepoGuardEslintConfig } from '../src/gates/quality/eslint-preset.js';

test('creates the core AI maintainability policy', () => {
  const configs = createRepoGuardEslintConfig({ js });
  const policy = configs.find(({ name }) => name === 'repo-guard/ai-maintainability');

  assert.ok(configs.includes(js.configs.recommended));
  assert.deepEqual(policy.linterOptions, {
    noInlineConfig: false,
    reportUnusedDisableDirectives: 'error',
    reportUnusedInlineConfigs: 'error',
  });
  assert.deepEqual(policy.rules.complexity, ['error', 15]);
  assert.deepEqual(policy.rules['max-lines-per-function'], ['error', {
    max: 120,
    skipBlankLines: true,
    skipComments: true,
  }]);
  assert.deepEqual(policy.rules['no-console'], [
    'error',
    { allow: ['warn', 'error'] },
  ]);
  assert.equal(policy.rules['no-eval'], 'error');
  assert.equal(policy.rules['prefer-const'], 'error');
});

test('merges optional consuming Vue and TypeScript presets and plugins', () => {
  const vue = {
    configs: {
      'flat/recommended-error': [{ name: 'consumer/vue-recommended' }],
    },
  };
  const typescript = {
    configs: {
      recommended: [{ name: 'consumer/typescript-recommended' }],
      stylistic: [{ name: 'consumer/typescript-stylistic' }],
    },
    parser: { name: 'consumer-typescript-parser' },
    plugin: { name: 'consumer-typescript-plugin' },
  };

  const configs = createRepoGuardEslintConfig({ typescript, vue });
  const names = configs.map(({ name }) => name);
  const vuePolicy = configs.find(({ name }) => name === 'repo-guard/ai-vue');
  const typescriptPolicy = configs.find(
    ({ name }) => name === 'repo-guard/ai-typescript',
  );

  assert.deepEqual(names.slice(0, 3), [
    'consumer/typescript-recommended',
    'consumer/typescript-stylistic',
    'consumer/vue-recommended',
  ]);
  assert.equal(vuePolicy.plugins.vue, vue);
  assert.equal(vuePolicy.languageOptions.parserOptions.parser, typescript.parser);
  assert.deepEqual(
    vuePolicy.rules['vue/component-api-style'],
    ['error', ['script-setup', 'composition']],
  );
  assert.deepEqual(
    vuePolicy.rules['vue/max-template-depth'],
    ['error', { maxDepth: 5 }],
  );
  assert.equal(
    typescriptPolicy.plugins['@typescript-eslint'],
    typescript.plugin,
  );
  assert.equal(
    typescriptPolicy.rules['@typescript-eslint/consistent-type-imports'],
    'error',
  );
  assert.equal(
    typescriptPolicy.rules['@typescript-eslint/no-explicit-any'],
    'warn',
  );
});

test('accepts the standard Vue flat recommended preset as a fallback', () => {
  const vueRecommended = { name: 'consumer/vue-recommended' };
  const vue = {
    configs: {
      'flat/recommended': [vueRecommended],
    },
  };

  const configs = createRepoGuardEslintConfig({ vue });
  const vuePolicy = configs.find(({ name }) => name === 'repo-guard/ai-vue');

  assert.ok(configs.includes(vueRecommended));
  assert.equal('languageOptions' in vuePolicy, false);
});

test('lets later project flat configs override repo-guard rules', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    baseConfig: createRepoGuardEslintConfig({ js }),
    overrideConfig: [
      {
        name: 'project/overrides',
        files: ['**/*.js'],
        rules: {
          complexity: ['error', 25],
          'no-console': 'off',
        },
      },
    ],
  });

  const config = await eslint.calculateConfigForFile('src/example.js');
  assert.deepEqual(config.rules.complexity, [2, 25]);
  assert.equal(config.rules['no-console'][0], 0);
});

test('rejects invalid consuming integrations', () => {
  assert.throws(
    () => createRepoGuardEslintConfig({ vue: { configs: {} } }),
    /eslint-plugin-vue configs/,
  );
  assert.throws(
    () => createRepoGuardEslintConfig({
      typescript: {
        configs: { recommended: {}, stylistic: {} },
        parser: {},
      },
    }),
    /typescript-eslint plugin/,
  );
});

test('automatically loads the preset dependencies from the consuming project', async () => {
  const preset = await resolveRepoGuardEslintPreset(process.cwd(), '9.19.0');

  assert.match(preset.integrations[0], /^@eslint\/js /);
  assert.ok(
    preset.configs.some(({ name }) => name === 'repo-guard/ai-maintainability'),
  );
  await assert.rejects(
    resolveRepoGuardEslintPreset(process.cwd(), '9.18.0'),
    /要求安装 ESLint >=9\.19/,
  );
});
