import { pathToFileURL } from 'node:url';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { buildEslintAiRepairInstructions } from './eslint-diagnostics.js';
import { resolveProjectPackageMetadata } from './project-package.js';
import { normalizeStagedFiles } from './staged-files.js';

export function resolveProjectEslintMetadata(root) {
  return resolveProjectPackageMetadata(root, 'eslint', 'ESLint');
}

async function loadProjectEslint(root) {
  const metadata = resolveProjectEslintMetadata(root);
  const eslintModule = await import(pathToFileURL(metadata.entryPath).href);
  const ESLint = eslintModule.ESLint || eslintModule.default?.ESLint;

  if (typeof ESLint !== 'function') {
    throw new Error(
      `Unsupported ESLint ${metadata.version}: the ESLint class is not available`,
    );
  }

  return {
    ESLint,
    version: metadata.version,
  };
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

function summarize(results) {
  return results.reduce(
    (summary, result) => ({
      errors: summary.errors + result.errorCount,
      fatalErrors: summary.fatalErrors + result.fatalErrorCount,
      warnings: summary.warnings + result.warningCount,
    }),
    { errors: 0, fatalErrors: 0, warnings: 0 },
  );
}

function hasBlockingProblems(summary, maxWarnings) {
  return summary.errors > 0 || summary.warnings > maxWarnings;
}

function printRepairInstructions(root, results, maxWarnings) {
  console.error(buildEslintAiRepairInstructions({ root, results, maxWarnings }));
}

export async function runEslintFiles({
  root,
  files,
  fix,
  maxWarnings,
}) {
  if (files.length === 0) {
    return 0;
  }

  const { ESLint, version } = await loadProjectEslint(root);
  const normalizedFiles = normalizeStagedFiles(root, files, 'ESLint')
    .map(({ absolute }) => absolute);
  const initialEslint = new ESLint({ cwd: root, fix: false });
  const lintableFiles = await collectLintableFiles(initialEslint, normalizedFiles);

  if (lintableFiles.length === 0) {
    console.log(`ESLint ${version}: all staged files are ignored by the project configuration.`);
    return 0;
  }

  const initialResults = await initialEslint.lintFiles(lintableFiles);
  const initialSummary = summarize(initialResults);
  if (!hasBlockingProblems(initialSummary, maxWarnings)) {
    console.log(`ESLint ${version} passed: ${lintableFiles.length} staged file(s).`);
    return 0;
  }

  if (!fix) {
    printRepairInstructions(root, initialResults, maxWarnings);
    console.error('ESLint 检查未通过，请按上面的编号信息修复后重新提交。');
    return 1;
  }

  const fixingEslint = new ESLint({ cwd: root, fix: true });
  const originalContents = captureFileContents(lintableFiles);
  let finalEslint;
  let finalResults;

  try {
    const fixedResults = await fixingEslint.lintFiles(lintableFiles);
    await ESLint.outputFixes(fixedResults);

    finalEslint = new ESLint({ cwd: root, fix: false });
    finalResults = await finalEslint.lintFiles(lintableFiles);
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }

  const finalSummary = summarize(finalResults);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    printRepairInstructions(root, finalResults, maxWarnings);
    console.error(
      `ESLint 自动修复后仍有 ${finalSummary.errors} 个错误、`
      + `${finalSummary.warnings} 个警告，提交已停止。`,
    );
    return 1;
  }

  console.log(
    `ESLint ${version} auto-fix and verification passed: `
    + `${lintableFiles.length} staged file(s).`,
  );
  return 0;
}
