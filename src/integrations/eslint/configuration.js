import { loadProjectEslintIntegration, resolveProjectEslintMetadata } from './project.js';
import { configurationError } from '../../core/error/repo-guard-error.js';

const SCRIPT_FILES = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}'];
const TS_FILES = ['**/*.{ts,mts,cts,tsx,vue}'];

/** JSON 规则转换为工具配置；ESLint 在其后读取用户 Flat Config，保留覆盖顺序。 */
export async function resolveInlineEslintConfig(root, options, descriptor) {
  const [major, minor] = resolveProjectEslintMetadata(root).version.split('.').map(Number);
  if (major < 9 || (major === 9 && minor < 19)) throw configurationError('eslint/inline-version', '内联前端预设要求 ESLint >=9.19。');
  const load = async (name) => (await loadProjectEslintIntegration(root, name, name, true)).module;
  const js = await load('@eslint/js');
  const vue = descriptor?.preset?.startsWith('vue-') ? await load('eslint-plugin-vue') : null;
  const ts = descriptor?.preset?.endsWith('-typescript') ? await load('typescript-eslint') : null;
  const globals = await load('globals');
  const prettier = await load('eslint-config-prettier');
  const configs = [
    { ignores: options.ignores ?? [] },
    ...(options.recommended ? [{ ...js.configs.recommended, files: SCRIPT_FILES }] : []),
    { files: SCRIPT_FILES, linterOptions: options.linterOptions ?? {},
      languageOptions: { globals: {
        ...(options.globals?.browser ? globals.browser : {}),
        ...(options.globals?.node ? globals.node : {}),
      } }, rules: options.rules ?? {} },
  ];
  if (ts) {
    const recommended = options.recommended ? ts.configs.recommended : [];
    configs.push(...recommended.map((config) => ({ ...config, files: TS_FILES })), {
      files: TS_FILES, plugins: { '@typescript-eslint': ts.plugin },
      languageOptions: { parser: ts.parser,
        ...(options.typeAware ? { parserOptions: { projectService: true, tsconfigRootDir: root, extraFileExtensions: ['.vue'] } } : {}) },
      rules: { ...options.typescriptRules, ...(options.typeAware ? options.typedRules : {}) },
    });
  }
  if (vue) {
    const recommended = options.recommended ? vue.configs['flat/recommended'] : [];
    configs.push(...recommended.map((config) => ({ ...config, files: ['**/*.vue'] })), {
      files: ['**/*.vue'], plugins: { vue },
      languageOptions: { parser: vue.configs['flat/base'][0].languageOptions?.parser
        ?? vue.configs['flat/base'].find((config) => config.languageOptions?.parser)?.languageOptions.parser,
        parserOptions: { ...(ts ? { parser: ts.parser } : {}), extraFileExtensions: ['.vue'],
          ...(ts && options.typeAware ? { projectService: true, tsconfigRootDir: root } : {}) } },
      rules: options.vueRules ?? {},
    });
  }
  configs.push(prettier);
  return configs;
}
