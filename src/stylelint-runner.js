import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { normalizeStagedFiles } from './staged-files.js';
import { findStructuredException } from './exception-registry.js';
import { buildStylelintAiRepairInstructions } from './stylelint-diagnostics.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from './stylelint-project.js';
import { assertVueStyleLanguages } from './vue-style-languages.js';

export const STYLE_COMPLEXITY_RULES = Object.freeze({
  maxCompoundSelectors: 'selector-max-compound-selectors',
  maxNestingDepth: 'max-nesting-depth',
});

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

function activeFileCount(results) {
  return new Set(activeResults(results).map(({ source }) => source)).size;
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

function complexityConfig(projectConfig, complexity) {
  const customSyntax = projectConfig?.customSyntax;
  return {
    ...(customSyntax ? { customSyntax } : {}),
    rules: {
      [STYLE_COMPLEXITY_RULES.maxCompoundSelectors]: complexity.maxCompoundSelectors,
      [STYLE_COMPLEXITY_RULES.maxNestingDepth]: complexity.maxNestingDepth,
    },
  };
}

async function lint(stylelint, root, files, fix) {
  return await stylelint.lint({
    cwd: root,
    files: files.map((file) => file.replace(/\\/g, '/')),
    fix,
  });
}

async function lintComplexity(stylelint, root, files, complexity) {
  if (!complexity?.enabled) return { results: [] };
  const results = await Promise.all(files.map(async (file) => {
    const projectConfig = await stylelint.resolveConfig(file, { cwd: root });
    if (!projectConfig) {
      throw new Error(`Stylelint could not resolve project configuration for ${file}`);
    }
    return await stylelint.lint({
      code: readFileSync(file, 'utf8'),
      codeFilename: file,
      config: complexityConfig(projectConfig, complexity),
      configBasedir: root,
      cwd: root,
      ...(projectConfig?.customSyntax
        ? { customSyntax: projectConfig.customSyntax }
        : {}),
      ignoreDisables: true,
      ignorePath: path.join(tmpdir(), `repo-guard-stylelint-${randomUUID()}`),
    });
  }));
  return {
    results: results.flatMap((result) => result.results),
  };
}

function mergeLintResults(...reports) {
  return { results: reports.flatMap((report) => report.results) };
}

function withoutProjectComplexityWarnings(report, complexity) {
  if (!complexity?.enabled) return report;
  return {
    results: report.results.map((result) => ({
      ...result,
      warnings: (result.warnings ?? []).filter(
        ({ rule }) => !Object.values(STYLE_COMPLEXITY_RULES).includes(rule),
      ),
    })),
  };
}

function applyComplexityExceptions(root, report, exceptions) {
  const approved = [];
  const results = report.results.map((result) => ({
    ...result,
    warnings: (result.warnings ?? []).filter((warning) => {
      if (!Object.values(STYLE_COMPLEXITY_RULES).includes(warning.rule)) return true;
      const finding = {
        path: path.relative(root, result.source).replace(/\\/g, '/'),
        line: warning.line,
        column: warning.column,
        rule: `style/${warning.rule}`,
      };
      const exception = findStructuredException(exceptions, finding);
      if (!exception) {
        warning.rule = finding.rule;
        return true;
      }
      approved.push({ ...finding, exception });
      return false;
    }),
  }));
  return { approved, results };
}

function reportApprovedComplexity(approved) {
  for (const finding of approved) {
    console.warn(
      `Style complexity approved exception: ${finding.path}:${finding.line}:${finding.column} `
      + `${finding.rule} (${finding.exception.id}, expires=${finding.exception.expiresOn}).`,
    );
  }
}

export async function runStylelintFiles({
  root,
  files,
  fix,
  maxWarnings,
  requireConfig,
  complexity,
  exceptions = { entries: [] },
  complexityOnly = false,
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
  const initialComplexity = await lintComplexity(
    stylelint,
    root,
    normalizedFiles,
    complexity,
  );
  const initial = applyComplexityExceptions(
    root,
    complexityOnly
      ? initialComplexity
      : mergeLintResults(
        withoutProjectComplexityWarnings(
          await lint(stylelint, root, normalizedFiles, false),
          complexity,
        ),
        initialComplexity,
      ),
    exceptions,
  );
  reportApprovedComplexity(initial.approved);
  const initialSummary = summarize(initial.results);
  const lintedCount = activeFileCount(initial.results);
  const ignoredCount = normalizedFiles.length - lintedCount;

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
    final = applyComplexityExceptions(
      root,
      mergeLintResults(
        withoutProjectComplexityWarnings(
          await lint(stylelint, root, normalizedFiles, false),
          complexity,
        ),
        await lintComplexity(stylelint, root, normalizedFiles, complexity),
      ),
      exceptions,
    );
    reportApprovedComplexity(final.approved);
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

export async function runStyleComplexityProject({ root, files, config, exceptions }) {
  return await runStylelintFiles({
    root,
    files,
    fix: false,
    maxWarnings: 0,
    requireConfig: true,
    complexity: config,
    complexityOnly: true,
    exceptions,
  });
}
