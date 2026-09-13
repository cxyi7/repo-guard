import path from 'node:path';
import {
  configurationError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import {
  captureFileContents,
  restoreFileContents,
} from '../../core/execution/file-snapshot.js';
import { normalizeStagedFiles } from '../../core/execution/staged-files.js';
import { findStructuredException } from '../../policies/exception-registry.js';
import { executeProjectStylelint } from '../../integrations/stylelint/execution.js';
import { inspectStyleGovernance } from '../../integrations/stylelint/governance.js';
import {
  findProjectStylelintConfig,
  loadProjectStylelint,
} from '../../integrations/stylelint/project.js';
import { assertVueStyleLanguages } from '../../policies/vue-style-languages.js';
import { createGateResult } from '../../core/result/gate-result.js';
export const STYLELINT_GATE_ID = 'quality.stylelint';
function activeResults(results) {
  return results.filter(({ ignored }) => !ignored);
}

function activeFileCount(results) {
  return new Set(activeResults(results).map(({ source }) => source)).size;
}

function summarize(results) {
  return activeResults(results).reduce(
    (summary, result) => ({
      errors:
        summary.errors +
        (result.warnings || []).filter(({ severity }) => severity === 'error')
          .length +
        (result.invalidOptionWarnings || []).length,
      warnings:
        summary.warnings +
        (result.warnings || []).filter(({ severity }) => severity === 'warning')
          .length,
    }),
    { errors: 0, warnings: 0 },
  );
}

function hasBlockingProblems(summary, maxWarnings) {
  return summary.errors > 0 || summary.warnings > maxWarnings;
}

function applyOwnedRuleExceptions(root, report, exceptions) {
  const ownedRules = new Set([
    'selector-max-compound-selectors',
    'max-nesting-depth',
    'selector-max-specificity',
    'selector-max-id',
    'declaration-no-important',
    'no-unexpected-global-style',
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
    (total, result) =>
      total +
      (result.warnings || []).filter(({ severity }) => severity === 'warning')
        .length,
    0,
  );
  const warningsBlock = warningCount > maxWarnings;
  return results.flatMap((result) => [
    ...(result.warnings || [])
      .filter(
        (message) =>
          message.severity === 'error' ||
          (warningsBlock && message.severity === 'warning'),
      )
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
      location: {
        path: path.relative(root, result.source).replace(/\\/g, '/'),
      },
      remediation: '修正项目 Stylelint 选项，同时保留该规则。',
    })),
  ]);
}

/** 普通规则只执行合并后的配置，治理扩展只读检查；失败恢复原始内容。 */
export async function runStylelintFiles({
  gateId = STYLELINT_GATE_ID,
  root,
  files,
  fix = false,
  maxWarnings = 0,
  requireConfig = true,
  governance,
  exceptions = { entries: [] },
  options,
}) {
  if (!files.length)
    return createGateResult({
      gateId,
      status: 'skipped',
      summary: 'Stylelint 没有适用文件',
    });
  const normalizedFiles = normalizeStagedFiles(
    root,
    files,
    'Stylelint 检查',
  ).map(({ absolute }) => absolute);
  assertVueStyleLanguages(normalizedFiles, root);
  if (requireConfig && !options && !findProjectStylelintConfig(root))
    throw configurationError(
      'stylelint/missing-project-config',
      'Stylelint 要求项目提供配置文件或内联预设',
    );
  const project = await loadProjectStylelint(root);
  const inspect = async () => {
    const report = await executeProjectStylelint({
      project,
      root,
      files: normalizedFiles,
      fix: false,
      options,
    });
    const invalid = report.results.filter(
      (r) =>
        r.invalidOptionWarnings?.length ||
        r.parseErrors?.length ||
        r.warnings?.some((w) => w.rule === 'CssSyntaxError'),
    );
    if (invalid.length)
      throw configurationError(
        'stylelint/invalid-input',
        'Stylelint 配置或样式语法无法解析，请查看第三方诊断。',
        {
          details: {
            diagnostics: [
              {
                level: 'error',
                source: 'stylelint',
                message: '第三方原始诊断：' + JSON.stringify(invalid),
              },
            ],
          },
        },
      );
    const active = report.results
      .filter((r) => !r.ignored)
      .map((r) => r.source);
    const extra = governance?.enabled
      ? await inspectStyleGovernance({
          project,
          root,
          files: active,
          options,
          governance,
        })
      : [];
    return applyOwnedRuleExceptions(
      root,
      { results: [...report.results, ...extra] },
      exceptions,
    );
  };
  let report = await inspect();
  const checkedFiles = activeFileCount(report.results);
  if (!checkedFiles)
    return createGateResult({
      gateId,
      status: 'skipped',
      summary: '所有文件均被项目 Stylelint 配置忽略',
    });
  let summary = summarize(report.results);
  if (fix && hasBlockingProblems(summary, maxWarnings)) {
    const snapshot = captureFileContents(normalizedFiles);
    try {
      await executeProjectStylelint({
        project,
        root,
        files: normalizedFiles,
        fix: true,
        options,
      });
      report = await inspect();
      summary = summarize(report.results);
      if (hasBlockingProblems(summary, maxWarnings))
        restoreFileContents(snapshot);
    } catch (error) {
      restoreFileContents(snapshot);
      throw toRepoGuardError(error, {
        code: 'stylelint/execution-failed',
        message: 'Stylelint 执行失败，已恢复本次文件修改。',
      });
    }
  }
  const failed = hasBlockingProblems(summary, maxWarnings);
  return createGateResult({
    gateId,
    status: failed ? 'violation' : 'passed',
    summary: failed ? 'Stylelint 样式检查发现违规' : 'Stylelint 样式检查已通过',
    findings: failed
      ? stylelintFindings(root, report.results, maxWarnings)
      : [],
    metrics: {
      checkedFiles,
      ignoredFiles: normalizedFiles.length - checkedFiles,
      ...summary,
      approvedExceptions: report.approved.length,
    },
  });
}
