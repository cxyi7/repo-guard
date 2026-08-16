import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import {
  captureFileContents,
  restoreFileContents,
} from '../../core/execution/file-snapshot.js';
import { normalizeStagedFiles } from '../../core/execution/staged-files.js';
import { findStructuredException } from '../../policies/exception-registry.js';
import {
  executeProjectStylelint,
  executeProjectStylelintRules,
  inspectProjectStylelintRuleInputs,
} from '../../integrations/stylelint/execution.js';
import {
  findProjectStylelintConfig,
  loadProjectStylelint,
} from '../../integrations/stylelint/project.js';
import { assertVueStyleLanguages } from '../../policies/vue-style-languages.js';
import { inspectUnexpectedGlobalStyles } from '../../policies/style-governance.js';
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
      }).map(({ source, violations }) => ({ source, warnings: violations })),
    ],
  };
}

function mergeLintResults(...reports) {
  return { results: reports.flatMap((report) => report.results) };
}

function withoutProjectComplexityMessages(report, complexity) {
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

function withoutProjectGovernanceMessages(report, governance) {
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
    warnings: (result.warnings ?? []).flatMap((message) => {
      if (!ownedRules.has(message.rule)) return [message];
      const finding = {
        path: path.relative(root, result.source).replace(/\\/g, '/'),
        line: message.line,
        column: message.column,
        rule: `style/${message.rule}`,
      };
      const exception = findStructuredException(exceptions, finding);
      if (!exception) {
        return [{ ...message, rule: finding.rule }];
      }
      approved.push({ ...finding, exception });
      return [];
    }),
  }));
  return { approved, results };
}

function stylelintFindings(root, results, maxWarnings) {
  const warningCount = results.reduce(
    (total, result) => total
      + (result.warnings || []).filter(({ severity }) => severity === 'warning').length,
    0,
  );
  const warningsBlock = warningCount > maxWarnings;
  return results.flatMap((result) => [
    ...(result.warnings || [])
      .filter((message) => message.severity === 'error'
        || (warningsBlock && message.severity === 'warning'))
      .map((message) => ({
        ruleId: message.rule?.startsWith('style/')
          ? message.rule
          : `stylelint/${message.rule || 'syntax-error'}`,
        severity: message.severity === 'warning' ? 'warning' : 'error',
        message: message.text || 'Stylelint 违规',
        location: {
          path: path.relative(root, result.source).replace(/\\/g, '/'),
          ...(message.line ? { line: message.line } : {}),
          ...(message.column ? { column: message.column } : {}),
        },
        remediation: message.rule
          ? `修复 Stylelint 规则报告的根因：${message.rule}，且不得禁用该规则。`
          : '修正样式表语法，且不得削弱 Stylelint 校验。',
      })),
    ...(result.invalidOptionWarnings || []).map((message) => ({
      ruleId: 'stylelint/invalid-option',
      severity: 'error',
      message: message.text || message.message || 'Stylelint 选项无效',
      location: { path: path.relative(root, result.source).replace(/\\/g, '/') },
      remediation: '修正项目 Stylelint 选项，同时保留该规则。',
    })),
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
    return createGateResult({ gateId, status: 'skipped', summary: 'Stylelint 没有适用文件' });
  }

  const normalizedFiles = normalizeStagedFiles(root, files, 'Stylelint 检查')
    .map(({ absolute }) => absolute);
  assertVueStyleLanguages(normalizedFiles, root);

  const configFile = findProjectStylelintConfig(root);
  if (requireConfig && !configFile) {
    throw configurationError('stylelint/missing-project-config', 'Stylelint 暂存门禁要求项目提供 Stylelint 配置文件');
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
        withoutProjectGovernanceMessages(
          withoutProjectComplexityMessages(
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
    return createGateResult({ gateId, status: 'passed', summary: `Stylelint ${project.version} 已通过`, metrics: { checkedFiles: lintedCount, ignoredFiles: ignoredCount, approvedExceptions: initial.approved.length } });
  }

  if (!fix) {
    return createGateResult({ gateId, status: 'violation', summary: `Stylelint 发现 ${initialSummary.errors} 个错误和 ${initialSummary.warnings} 个警告`, findings: stylelintFindings(root, initial.results, maxWarnings), metrics: { checkedFiles: lintedCount, errors: initialSummary.errors, warnings: initialSummary.warnings, approvedExceptions: initial.approved.length } });
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
        withoutProjectGovernanceMessages(
          withoutProjectComplexityMessages(
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
    return createGateResult({ gateId, status: 'violation', summary: `Stylelint 自动修复后仍有 ${finalSummary.errors} 个错误和 ${finalSummary.warnings} 个警告`, findings: stylelintFindings(root, final.results, maxWarnings), metrics: { checkedFiles: lintedCount, errors: finalSummary.errors, warnings: finalSummary.warnings, approvedExceptions: final.approved.length } });
  }

  return createGateResult({ gateId, status: 'passed', summary: `Stylelint ${project.version} 自动修复和校验已通过`, metrics: { checkedFiles: lintedCount, errors: 0, warnings: finalSummary.warnings, approvedExceptions: final.approved.length } });
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
