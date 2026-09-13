import { normalizeStagedFiles } from '../../core/execution/staged-files.js';
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { configurationError } from '../../core/error/repo-guard-error.js';

function snapshotParser(parser, boundary) {
  if (typeof parser?.parseForESLint !== 'function') return parser;
  return { ...parser, parseForESLint(...args) {
    const result = parser.parseForESLint(...args);
    for (const source of result.services?.program?.getSourceFiles() ?? []) {
      const absolute = existsSync(source.fileName) ? realpathSync(source.fileName) : path.resolve(source.fileName);
      const relative = path.relative(boundary, absolute);
      if ((relative.startsWith('..') || path.isAbsolute(relative)) && !absolute.split(path.sep).includes('node_modules')) {
        throw configurationError('eslint/type-source-outside-snapshot', '类型感知检查解析到了索引快照外的源码；请使用应用内相对类型路径，或先处理工作区依赖映射。');
      }
    }
    return result;
  } };
}

export async function inlineEslintNativeConfig(root, ESLint) {
  const file = await new ESLint({ cwd: root }).findConfigFile();
  if (!file) return true;
  let boundary = path.resolve(root);
  while (!existsSync(path.join(boundary, '.git')) && path.dirname(boundary) !== boundary) boundary = path.dirname(boundary);
  const relative = path.relative(boundary, file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? true : file;
}

async function collectLintableFiles(eslint, files) {
  const lintable = [];
  for (const file of files) {
    if (!(await eslint.isPathIgnored(file))) {
      lintable.push(file);
    }
  }
  return lintable;
}

export async function prepareProjectEslintExecution({
  root,
  files,
  project,
  baseConfig = null,
  allowMissingConfig = false,
  sourceBoundary,
}) {
  const configFile = allowMissingConfig ? await inlineEslintNativeConfig(root, project.ESLint) : undefined;
  const eslintOptions = (fix) => ({
    cwd: root,
    fix,
    ...(baseConfig ? { baseConfig } : {}),
    ...(allowMissingConfig ? { overrideConfigFile: configFile } : {}),
  });
  const normalizedFiles = normalizeStagedFiles(root, files, 'ESLint 检查')
    .map(({ absolute }) => absolute);
  let initialEslint = new project.ESLint(eslintOptions(false));
  const parserOverrides = [];
  if (sourceBoundary) {
    for (const file of normalizedFiles) {
      const config = await initialEslint.calculateConfigForFile(file);
      if (config) parserOverrides.push({ files: [path.relative(root, file).replaceAll('\\', '/')],
        languageOptions: { parser: snapshotParser(config.languageOptions.parser, sourceBoundary) } });
    }
    initialEslint = new project.ESLint({ ...eslintOptions(false), overrideConfig: parserOverrides });
  }
  const lintableFiles = await collectLintableFiles(initialEslint, normalizedFiles);
  let initialEslintAvailable = true;

  return {
    lintableFiles,
    async lint({ fix }) {
      const eslint = !fix && initialEslintAvailable
        ? initialEslint
        : new project.ESLint({ ...eslintOptions(fix), ...(sourceBoundary ? { overrideConfig: parserOverrides } : {}) });
      initialEslintAvailable = false;
      const results = await eslint.lintFiles(lintableFiles);
      if (fix) {
        await project.ESLint.outputFixes(results);
      }
      return results;
    },
  };
}
