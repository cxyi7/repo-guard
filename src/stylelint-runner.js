import { pathToFileURL } from 'node:url';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { normalizeStagedFiles } from './staged-files.js';
import { buildStylelintAiRepairInstructions } from './stylelint-diagnostics.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from './stylelint-project.js';
import { assertVueStyleLanguages } from './vue-style-languages.js';

async function loadProjectStylelint(root) {
  const metadata = resolveProjectStylelintMetadata(root);
  const stylelintModule = await import(pathToFileURL(metadata.entryPath).href);
  const stylelint = typeof stylelintModule.lint === 'function'
    ? stylelintModule
    : stylelintModule.default;

  if (!stylelint || typeof stylelint.lint !== 'function') {
    throw new Error(
      `Unsupported Stylelint ${metadata.version}: the lint API is not available`,
    );
  }

  return {
    stylelint,
    version: metadata.version,
  };
}

function activeResults(results) {
  return results.filter(({ ignored }) => !ignored);
}

function summarize(results) {
  return activeResults(results).reduce(
    (summary, result) => ({
      errors: summary.errors
        + (result.warnings || []).filter(({ severity }) => severity === 'error').length
        + (result.invalidOptionWarnings || []).length,
      warnings: summary.warnings
        + (result.warnings || []).filter(({ severity }) => severity === 'warning').length,
    }),
    { errors: 0, warnings: 0 },
  );
}

function hasBlockingProblems(summary, maxWarnings) {
  return summary.errors > 0 || summary.warnings > maxWarnings;
}

function printRepairInstructions(root, results, maxWarnings) {
  console.error(buildStylelintAiRepairInstructions({ root, results, maxWarnings }));
}

async function lint(stylelint, root, files, fix) {
  return await stylelint.lint({
    cwd: root,
    files: files.map((file) => file.replace(/\\/g, '/')),
    fix,
  });
}

export async function runStylelintFiles({
  root,
  files,
  fix,
  maxWarnings,
  requireConfig,
}) {
  if (files.length === 0) {
    return 0;
  }

  const normalizedFiles = normalizeStagedFiles(root, files, 'Stylelint')
    .map(({ absolute }) => absolute);
  assertVueStyleLanguages(normalizedFiles, root);

  const configFile = findProjectStylelintConfig(root);
  if (requireConfig && !configFile) {
    throw new Error('Stylelint staged gate requires a project Stylelint configuration file');
  }

  const { stylelint, version } = await loadProjectStylelint(root);
  const initial = await lint(stylelint, root, normalizedFiles, false);
  const initialSummary = summarize(initial.results);
  const lintedCount = activeResults(initial.results).length;
  const ignoredCount = initial.results.length - lintedCount;

  if (!hasBlockingProblems(initialSummary, maxWarnings)) {
    console.log(
      `Stylelint ${version} passed: ${lintedCount} staged file(s)`
      + `${ignoredCount > 0 ? `, ${ignoredCount} ignored` : ''}.`,
    );
    return 0;
  }

  if (!fix) {
    printRepairInstructions(root, initial.results, maxWarnings);
    console.error('Stylelint 检查未通过，请按上面的编号信息修复后重新提交。');
    return 1;
  }

  const originalContents = captureFileContents(normalizedFiles);
  let final;
  try {
    await lint(stylelint, root, normalizedFiles, true);
    final = await lint(stylelint, root, normalizedFiles, false);
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }

  const finalSummary = summarize(final.results);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    printRepairInstructions(root, final.results, maxWarnings);
    console.error(
      `Stylelint 自动修复后仍有 ${finalSummary.errors} 个错误、`
      + `${finalSummary.warnings} 个警告，提交已停止。`,
    );
    return 1;
  }

  console.log(
    `Stylelint ${version} auto-fix and verification passed: ${lintedCount} staged file(s).`,
  );
  return 0;
}
