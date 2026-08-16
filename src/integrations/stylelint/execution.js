import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

export async function executeProjectStylelint({ project, root, files, fix }) {
  return await project.stylelint.lint({
    cwd: root,
    files: files.map((file) => file.replace(/\\/g, '/')),
    fix,
  });
}

export async function inspectProjectStylelintRuleInputs({ project, root, files }) {
  return await Promise.all(files.map(async (file) => {
    const projectConfig = await project.stylelint.resolveConfig(file, { cwd: root });
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
