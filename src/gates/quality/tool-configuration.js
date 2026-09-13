import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { loadProjectEslint } from '../../integrations/eslint/project.js';
import { inlineEslintNativeConfig } from '../../integrations/eslint/execution.js';
import { resolveInlineEslintConfig } from '../../integrations/eslint/configuration.js';
import { loadProjectPrettier } from '../../integrations/prettier/project.js';
import { loadProjectStylelint } from '../../integrations/stylelint/project.js';
import { resolveInlineStylelintConfig } from '../../integrations/stylelint/configuration.js';
import { inspectTypecheckOptions } from '../../integrations/npm/typecheck-options.js';
import { resolveRepoGuardEslintPreset } from './eslint-gate.js';
import { getFrontendToolRequirements } from '../../profiles/frontend-tool-requirements.js';

export async function inspectFrontendToolConfiguration({ root, config, tool, file }) {
  if (!['eslint', 'prettier', 'stylelint', 'typeCheck'].includes(tool)) throw configurationError('tool-config/tool', '工具必须是 eslint、prettier、stylelint 或 typeCheck。');
  if (tool !== 'typeCheck' && (typeof file !== 'string' || !file)) throw configurationError('tool-config/file', '查询此工具时必须通过 --file 指定应用内文件。');
  const absolute = path.resolve(root, file ?? '.');
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw configurationError('tool-config/file-outside-project', '查询文件必须位于当前应用目录内。');
  const check = config.checks[tool];
  let effective;
  if (tool === 'eslint') {
    const { ESLint, version } = await loadProjectEslint(root);
    const baseConfig = check.options ? await resolveInlineEslintConfig(root, check.options, config.project)
      : check.preset ? (await resolveRepoGuardEslintPreset(root, version, config.project)).configs : undefined;
    const eslint = new ESLint({ cwd: root, baseConfig,
      ...(check.options ? { overrideConfigFile: await inlineEslintNativeConfig(root, ESLint) } : {}) });
    const resolved = await eslint.calculateConfigForFile(absolute);
    effective = resolved ? { rules: resolved.rules, linterOptions: resolved.linterOptions,
      globals: resolved.languageOptions?.globals, parser: resolved.languageOptions?.parser?.meta?.name,
      parserOptions: { projectService: resolved.languageOptions?.parserOptions?.projectService } } : { ignored: true };
  } else if (tool === 'prettier') {
    const { prettier } = await loadProjectPrettier(root);
    effective = { ...check.options, ...await prettier.resolveConfig(absolute, { editorconfig: true, useCache: false }) };
  } else if (tool === 'stylelint') {
    const project = await loadProjectStylelint(root);
    const resolved = check.options ? await resolveInlineStylelintConfig(project, root, absolute, check.options)
      : await project.stylelint.resolveConfig(absolute, { cwd: root });
    effective = { rules: resolved?.rules, ignoreFiles: resolved?.ignoreFiles,
      customSyntax: typeof resolved?.customSyntax === 'string' ? resolved.customSyntax : Boolean(resolved?.customSyntax), plugins: resolved?.plugins };
  } else {
    effective = check.options ? inspectTypecheckOptions(root, check.options).targets.map((target) => ({
      configFile: path.relative(root, target.file).replaceAll('\\', '/'),
      compilerOptions: target.effective, appliedDefaults: target.defaults,
    })) : { script: check.script };
  }
  return { version: 2, project: config.project.id, tool, enabled: check.enabled,
    precedence: '项目原生配置优先；未覆盖选项使用 repo-guard 配置；查询成功不代表检查通过。',
    configured: check.options ?? null, effective, requirements: getFrontendToolRequirements(config) };
}
