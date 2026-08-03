import micromatch from 'micromatch';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { runEslintFiles } from './eslint-runner.js';
import { runPrettierFiles } from './prettier-runner.js';
import { normalizeStagedFiles } from './staged-files.js';

function selectFiles(files, pattern) {
  return files
    .filter(({ relative }) => micromatch.isMatch(relative, pattern, {
      dot: true,
      matchBase: true,
    }))
    .map(({ absolute }) => absolute);
}

function uniqueFiles(...groups) {
  return [...new Set(groups.flat())];
}

export async function runQualityFiles({ root, files, config }) {
  const normalizedFiles = normalizeStagedFiles(root, files, 'Quality gate');
  const eslintConfig = config.preCommit.eslint;
  const prettierConfig = config.preCommit.prettier;
  const eslintFiles = eslintConfig.enabled
    ? selectFiles(normalizedFiles, eslintConfig.pattern)
    : [];
  const prettierFiles = prettierConfig.enabled
    ? selectFiles(normalizedFiles, prettierConfig.pattern)
    : [];
  const relevantFiles = uniqueFiles(eslintFiles, prettierFiles);

  if (relevantFiles.length === 0) {
    console.log('repo-guard quality gate: no staged files matched the configured patterns.');
    return 0;
  }

  const originalContents = captureFileContents(relevantFiles);
  const fail = (exitCode) => {
    if (exitCode !== 0) {
      restoreFileContents(originalContents);
    }
    return exitCode;
  };

  try {
    if (eslintFiles.length > 0 && eslintConfig.fix) {
      const eslintFixExitCode = await runEslintFiles({
        root,
        files: eslintFiles,
        fix: true,
        maxWarnings: eslintConfig.maxWarnings,
      });
      if (eslintFixExitCode !== 0) {
        return fail(eslintFixExitCode);
      }
    }

    if (prettierFiles.length > 0) {
      const prettierExitCode = await runPrettierFiles({
        root,
        files: prettierFiles,
        fix: prettierConfig.fix,
        requireConfig: prettierConfig.requireConfig,
      });
      if (prettierExitCode !== 0) {
        return fail(prettierExitCode);
      }
    }

    if (eslintFiles.length > 0 && (!eslintConfig.fix || prettierFiles.length > 0)) {
      const eslintVerifyExitCode = await runEslintFiles({
        root,
        files: eslintFiles,
        fix: false,
        maxWarnings: eslintConfig.maxWarnings,
      });
      if (eslintVerifyExitCode !== 0) {
        return fail(eslintVerifyExitCode);
      }
    }

    return 0;
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }
}
