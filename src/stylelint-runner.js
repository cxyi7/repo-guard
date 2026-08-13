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
import { inspectUnexpectedGlobalStyles } from './style-governance.js';
import { createGateResult } from './core/result/gate-result.js';

export const STYLELINT_GATE_ID = 'quality.stylelint';

export const STYLE_COMPLEXITY_RULES = Object.freeze({
  maxCompoundSelectors: 'selector-max-compound-selectors',
  maxNestingDepth: 'max-nesting-depth',
});
export const STYLE_GOVERNANCE_RULES = Object.freeze({
  maxSpecificity: 'selector-max-specificity',
  maxIdSelectors: 'selector-max-id',
  disallowImportant: 'declaration-no-important',
  unexpectedGlobalStyle: 'no-unexpected-global-style',
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

function governanceConfig(projectConfig, governance) {
  const customSyntax = projectConfig?.customSyntax;
  return {
    ...(customSyntax ? { customSyntax } : {}),
    rules: {
      [STYLE_GOVERNANCE_RULES.maxSpecificity]: governance.maxSpecificity,
      [STYLE_GOVERNANCE_RULES.maxIdSelectors]: governance.maxIdSelectors,
      ...(governance.disallowImportant
        ? { [STYLE_GOVERNANCE_RULES.disallowImportant]: true }
        : {}),
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

async function lintGovernance(stylelint, root, files, governance) {
  if (!governance?.enabled) return { results: [] };
  const results = await Promise.all(files.map(async (file) => {
    const projectConfig = await stylelint.resolveConfig(file, { cwd: root });
    if (!projectConfig) {
      throw new Error(`Stylelint could not resolve project configuration for ${file}`);
    }
    return await stylelint.lint({
      code: readFileSync(file, 'utf8'),
      codeFilename: file,
      config: governanceConfig(projectConfig, governance),
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
    results: [
      ...results.flatMap((result) => result.results),
      ...inspectUnexpectedGlobalStyles({
        root,
        files,
        allowedPatterns: governance.allowedGlobalStylePatterns,
      }),
    ],
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

function withoutProjectGovernanceWarnings(report, governance) {
  if (!governance?.enabled) return report;
  const activeRules = new Set([
    STYLE_GOVERNANCE_RULES.maxSpecificity,
    STYLE_GOVERNANCE_RULES.maxIdSelectors,
    ...(governance.disallowImportant ? [STYLE_GOVERNANCE_RULES.disallowImportant] : []),
  ]);
  return {
    results: report.results.map((result) => ({
      ...result,
      warnings: (result.warnings ?? []).filter(
        ({ rule }) => !activeRules.has(rule),
      ),
    })),
  };
}

function applyOwnedRuleExceptions(root, report, exceptions, complexity, governance) {
  const ownedRules = new Set([
    ...(complexity?.enabled ? Object.values(STYLE_COMPLEXITY_RULES) : []),
    ...(governance?.enabled ? [
      STYLE_GOVERNANCE_RULES.maxSpecificity,
      STYLE_GOVERNANCE_RULES.maxIdSelectors,
      STYLE_GOVERNANCE_RULES.unexpectedGlobalStyle,
      ...(governance.disallowImportant ? [STYLE_GOVERNANCE_RULES.disallowImportant] : []),
    ] : []),
  ]);
  const approved = [];
  const results = report.results.map((result) => ({
    ...result,
    warnings: (result.warnings ?? []).filter((warning) => {
      if (!ownedRules.has(warning.rule)) return true;
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

function stylelintFindings(root, results, maxWarnings) {
  const warningCount = results.reduce((total, result) => total + (result.warnings || []).filter(({ severity }) => severity === 'warning').length, 0);
  const warningsBlock = warningCount > maxWarnings;
  return results.flatMap((result) => [
    ...(result.warnings || []).filter((warning) => warning.severity === 'error' || (warningsBlock && warning.severity === 'warning')).map((warning) => ({
      ruleId: warning.rule?.startsWith('style/') ? warning.rule : `stylelint/${warning.rule || 'syntax-error'}`,
      severity: warning.severity === 'warning' ? 'warning' : 'error',
      message: warning.text || 'Stylelint violation',
      location: { path: path.relative(root, result.source).replace(/\\/g, '/'), ...(warning.line ? { line: warning.line } : {}), ...(warning.column ? { column: warning.column } : {}) },
    })),
    ...(result.invalidOptionWarnings || []).map((warning) => ({ ruleId: 'stylelint/invalid-option', severity: 'error', message: warning.text || warning.message || 'Invalid Stylelint option', location: { path: path.relative(root, result.source).replace(/\\/g, '/') } })),
  ]);
}

export async function runStylelintFiles({
  gateId = STYLELINT_GATE_ID,
  root,
  files,
  fix,
  maxWarnings,
  requireConfig,
  complexity,
  governance,
  exceptions = { entries: [] },
  complexityOnly = false,
  governanceOnly = false,
}) {
  if (files.length === 0) {
    return createGateResult({ gateId, status: 'skipped', summary: 'Stylelint has no applicable files' });
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
  const initialGovernance = await lintGovernance(
    stylelint,
    root,
    normalizedFiles,
    governance,
  );
  const initial = applyOwnedRuleExceptions(
    root,
    complexityOnly
      ? initialComplexity
      : governanceOnly
        ? initialGovernance
        : mergeLintResults(
        withoutProjectGovernanceWarnings(
          withoutProjectComplexityWarnings(
            await lint(stylelint, root, normalizedFiles, false),
            complexity,
          ),
          governance,
        ),
        initialComplexity,
        initialGovernance,
      ),
    exceptions,
    complexity,
    governance,
  );
  const initialSummary = summarize(initial.results);
  const lintedCount = activeFileCount(initial.results);
  const ignoredCount = normalizedFiles.length - lintedCount;

  if (!hasBlockingProblems(initialSummary, maxWarnings)) {
    return createGateResult({ gateId, status: 'passed', summary: `Stylelint ${version} passed`, metrics: { checkedFiles: lintedCount, ignoredFiles: ignoredCount, approvedExceptions: initial.approved.length } });
  }

  if (!fix) {
    return createGateResult({ gateId, status: 'violation', summary: `Stylelint found ${initialSummary.errors} error(s) and ${initialSummary.warnings} warning(s)`, findings: stylelintFindings(root, initial.results, maxWarnings), diagnostics: [{ level: 'error', message: buildStylelintAiRepairInstructions({ root, results: initial.results, maxWarnings }) }], metrics: { checkedFiles: lintedCount, errors: initialSummary.errors, warnings: initialSummary.warnings, approvedExceptions: initial.approved.length } });
  }

  const originalContents = captureFileContents(normalizedFiles);
  let final;
  try {
    await lint(stylelint, root, normalizedFiles, true);
    final = applyOwnedRuleExceptions(
      root,
      mergeLintResults(
        withoutProjectGovernanceWarnings(
          withoutProjectComplexityWarnings(
            await lint(stylelint, root, normalizedFiles, false),
            complexity,
          ),
          governance,
        ),
        await lintComplexity(stylelint, root, normalizedFiles, complexity),
        await lintGovernance(stylelint, root, normalizedFiles, governance),
      ),
      exceptions,
      complexity,
      governance,
    );
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }

  const finalSummary = summarize(final.results);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    return createGateResult({ gateId, status: 'violation', summary: `Stylelint auto-fix left ${finalSummary.errors} error(s) and ${finalSummary.warnings} warning(s)`, findings: stylelintFindings(root, final.results, maxWarnings), diagnostics: [{ level: 'error', message: buildStylelintAiRepairInstructions({ root, results: final.results, maxWarnings }) }], metrics: { checkedFiles: lintedCount, errors: finalSummary.errors, warnings: finalSummary.warnings, approvedExceptions: final.approved.length } });
  }

  return createGateResult({ gateId, status: 'passed', summary: `Stylelint ${version} auto-fix and verification passed`, metrics: { checkedFiles: lintedCount, errors: 0, warnings: finalSummary.warnings, approvedExceptions: final.approved.length } });
}

export async function runStyleComplexityProject({ root, files, config, exceptions }) {
  return await runStylelintFiles({
    gateId: 'quality.style-complexity',
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

export async function runStyleGovernanceProject({ root, files, config, exceptions }) {
  return await runStylelintFiles({
    gateId: 'quality.style-governance',
    root,
    files,
    fix: false,
    maxWarnings: 0,
    requireConfig: true,
    governance: config,
    governanceOnly: true,
    exceptions,
  });
}
