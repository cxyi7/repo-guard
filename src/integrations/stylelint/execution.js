import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { resolveInlineStylelintConfig } from './configuration.js';

export async function executeProjectStylelint({ project, root, files, fix, options }) {
  if (options) {
    const reports = [];
    for (const file of files) {
      const config = await resolveInlineStylelintConfig(project, root, file, options);
      reports.push(await project.stylelint.lint({ cwd: root, configBasedir: root, config,
        files: [file.replaceAll('\\', '/')], fix }));
    }
    return { results: reports.flatMap((report) => report.results) };
  }
  return await project.stylelint.lint({
    cwd: root,
    files: files.map((file) => file.replace(/\\/g, '/')),
    fix,
  });
}

export async function inspectProjectStylelintRuleInputs({ project, root, files, options }) {
  return await Promise.all(files.map(async (file) => {
    const projectConfig = options ? await resolveInlineStylelintConfig(project, root, file, options)
      : await project.stylelint.resolveConfig(file, { cwd: root });
    if (!projectConfig) {
      throw configurationError(
        'stylelint/unresolved-project-config',
        `Stylelint 无法解析 ${file} 的项目配置`,
      );
    }
    return {
      code: readFileSync(file, 'utf8'),
      file,
      projectConfig,
    };
  }));
}

export async function executeProjectStylelintRules({
  project,
  root,
  inputs,
  bypassProjectIgnores = false,
  ignoreDisables = false,
}) {
  const reports = await Promise.all(inputs.map(async ({
    code,
    config,
    file,
    projectConfig,
  }) => await project.stylelint.lint({
    code,
    codeFilename: file,
    config,
    configBasedir: root,
    cwd: root,
    ...(projectConfig?.customSyntax
      ? { customSyntax: projectConfig.customSyntax }
      : {}),
    ignoreDisables,
    ...(bypassProjectIgnores
      ? { ignorePath: path.join(tmpdir(), `repo-guard-stylelint-${randomUUID()}`) }
      : {}),
  })));
  return {
    results: reports.flatMap((report) => report.results),
  };
}
