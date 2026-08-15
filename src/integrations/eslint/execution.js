import { normalizeStagedFiles } from '../../core/execution/staged-files.js';

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
}) {
  const eslintOptions = (fix) => ({
    cwd: root,
    fix,
    ...(baseConfig ? { baseConfig } : {}),
  });
  const normalizedFiles = normalizeStagedFiles(root, files, 'ESLint')
    .map(({ absolute }) => absolute);
  const initialEslint = new project.ESLint(eslintOptions(false));
  const lintableFiles = await collectLintableFiles(initialEslint, normalizedFiles);
  let initialEslintAvailable = true;

  return {
    lintableFiles,
    async lint({ fix }) {
      const eslint = !fix && initialEslintAvailable
        ? initialEslint
        : new project.ESLint(eslintOptions(fix));
      initialEslintAvailable = false;
      const results = await eslint.lintFiles(lintableFiles);
      if (fix) {
        await project.ESLint.outputFixes(results);
      }
      return results;
    },
  };
}
