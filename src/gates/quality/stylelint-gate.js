import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import {
  captureFileContents,
  restoreFileContents,
} from '../../core/execution/file-snapshot.js';
import { normalizeStagedFiles } from '../../core/execution/staged-files.js';
import { findStructuredException } from '../../exception-registry.js';
import {
  executeProjectStylelint,
  executeProjectStylelintRules,
  inspectProjectStylelintRuleInputs,
} from '../../integrations/stylelint/execution.js';
import {
  findProjectStylelintConfig,
  loadProjectStylelint,
} from '../../integrations/stylelint/project.js';
import { assertVueStyleLanguages } from '../../vue-style-languages.js';
import { inspectUnexpectedGlobalStyles } from '../../style-governance.js';
import { createGateResult } from '../../core/result/gate-result.js';

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

async function lintComplexity(project, root, files, complexity) {
  if (!complexity?.enabled) return { results: [] };
  const inputs = await inspectProjectStylelintRuleInputs({ project, root, files });
  return await executeProjectStylelintRules({
    project,
    root,
    bypassProjectIgnores: true,
    ignoreDisables: true,
    inputs: inputs.map((input) => ({
      ...input,
      config: complexityConfig(input.projectConfig, complexity),
    })),
  });
}

async function lintGovernance(project, root, files, governance) {
  if (!governance?.enabled) return { results: [] };
  const inputs = await inspectProjectStylelintRuleInputs({ project, root, files });
  const report = await executeProjectStylelintRules({
    project,
    root,
    bypassProjectIgnores: true,
    ignoreDisables: true,
    inputs: inputs.map((input) => ({
      ...input,
      config: governanceConfig(input.projectConfig, governance),
    })),
  });
  return {
    results: [
      ...report.results,
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
      remediation: warning.rule
        ? `Fix the root cause reported by Stylelint rule ${warning.rule} without disabling the rule.`
        : 'Correct the stylesheet syntax without weakening Stylelint verification.',
    })),
    ...(result.invalidOptionWarnings || []).map((warning) => ({ ruleId: 'stylelint/invalid-option', severity: 'error', message: warning.text || warning.message || 'Invalid Stylelint option', location: { path: path.relative(root, result.source).replace(/\\/g, '/') }, remediation: 'Correct the project Stylelint option while preserving the rule.' })),
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
    throw configurationError('stylelint/missing-project-config', 'Stylelint staged gate requires a project Stylelint configuration file');
  }

  const project = await loadProjectStylelint(root);
  const initialComplexity = await lintComplexity(
    project,
    root,
    normalizedFiles,
    complexity,
  );
  const initialGovernance = await lintGovernance(
    project,
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
            await executeProjectStylelint({
              project,
              root,
              files: normalizedFiles,
              fix: false,
            }),
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
    return createGateResult({ gateId, status: 'passed', summary: `Stylelint ${project.version} passed`, metrics: { checkedFiles: lintedCount, ignoredFiles: ignoredCount, approvedExceptions: initial.approved.length } });
  }

  if (!fix) {
    return createGateResult({ gateId, status: 'violation', summary: `Stylelint found ${initialSummary.errors} error(s) and ${initialSummary.warnings} warning(s)`, findings: stylelintFindings(root, initial.results, maxWarnings), metrics: { checkedFiles: lintedCount, errors: initialSummary.errors, warnings: initialSummary.warnings, approvedExceptions: initial.approved.length } });
  }

  const originalContents = captureFileContents(normalizedFiles);
  let final;
  try {
    await executeProjectStylelint({
      project,
      root,
      files: normalizedFiles,
      fix: true,
    });
    final = applyOwnedRuleExceptions(
      root,
      mergeLintResults(
        withoutProjectGovernanceWarnings(
          withoutProjectComplexityWarnings(
            await executeProjectStylelint({
              project,
              root,
              files: normalizedFiles,
              fix: false,
            }),
            complexity,
          ),
          governance,
        ),
        await lintComplexity(project, root, normalizedFiles, complexity),
        await lintGovernance(project, root, normalizedFiles, governance),
      ),
      exceptions,
      complexity,
      governance,
    );
  } catch (error) {
    restoreFileContents(originalContents);
    throw toRepoGuardError(error, {
      kind: 'execution',
      code: 'stylelint/execution-failed',
    });
  }

  const finalSummary = summarize(final.results);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    return createGateResult({ gateId, status: 'violation', summary: `Stylelint auto-fix left ${finalSummary.errors} error(s) and ${finalSummary.warnings} warning(s)`, findings: stylelintFindings(root, final.results, maxWarnings), metrics: { checkedFiles: lintedCount, errors: finalSummary.errors, warnings: finalSummary.warnings, approvedExceptions: final.approved.length } });
  }

  return createGateResult({ gateId, status: 'passed', summary: `Stylelint ${project.version} auto-fix and verification passed`, metrics: { checkedFiles: lintedCount, errors: 0, warnings: finalSummary.warnings, approvedExceptions: final.approved.length } });
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
