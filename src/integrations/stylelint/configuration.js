import { toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findProjectStylelintConfig } from './project.js';

async function resolvePartialNative(project, root, file) {
  let directory = path.dirname(file);
  while (true) {
    const found = findProjectStylelintConfig(directory);
    if (found) {
      const config = found === 'package.json#stylelint'
        ? { ...JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).stylelint, rules: {} }
        : { extends: [path.join(directory, found)], rules: {} };
      return await project.stylelint.resolveConfig(file, { cwd: root, configBasedir: directory, config });
    }
    if (path.dirname(directory) === directory) return undefined;
    directory = path.dirname(directory);
  }
}

/** 逐文件先解析两层 extends/overrides，再合并规则；用户规则元组整体替换。 */
export async function resolveInlineStylelintConfig(project, root, file, options) {
  const base = await project.stylelint.resolveConfig(file, { cwd: root, configBasedir: root, config: options });
  let native;
  try { native = await project.stylelint.resolveConfig(file, { cwd: root }); }
  catch (error) {
    if (error.code === 78 && error.message.startsWith('No rules found within configuration.')) native = await resolvePartialNative(project, root, file);
    else if (error.code !== 78 || !error.message.startsWith('No configuration provided for ')) throw toRepoGuardError(error, { kind: 'configuration', code: 'stylelint/native-config-invalid', message: '无法读取项目 Stylelint 配置。' });
  }
  const rules = Object.fromEntries(Object.entries({ ...base?.rules, ...native?.rules })
    .map(([name, setting]) => [name, Array.isArray(setting) && (setting.length === 0 || setting[0] === null) ? null : setting]));
  return { ...base, ...native,
    plugins: [...new Set([...(base?.plugins ?? []), ...(native?.plugins ?? [])])],
    rules,
  };
}
