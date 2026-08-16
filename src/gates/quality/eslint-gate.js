import path from 'node:path';
import {
  captureFileContents,
  restoreFileContents,
} from '../../core/execution/file-snapshot.js';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { prepareProjectEslintExecution } from '../../integrations/eslint/execution.js';
import {
  loadProjectEslint,
  loadProjectEslintIntegration,
} from '../../integrations/eslint/project.js';
import { createRepoGuardEslintConfig } from './eslint-preset.js';

export const ESLINT_GATE_ID = 'quality.eslint';

const MINIMUM_PRESET_ESLINT_VERSION = Object.freeze([9, 19]);

function supportsRepoGuardPreset(version) {
  const [major, minor] = String(version).split('.').map(Number);
  const [minimumMajor, minimumMinor] = MINIMUM_PRESET_ESLINT_VERSION;
  return major > minimumMajor
    || (major === minimumMajor && minor >= minimumMinor);
}

export async function resolveRepoGuardEslintPreset(root, eslintVersion) {
  if (!supportsRepoGuardPreset(eslintVersion)) {
    throw configurationError(
      'eslint/unsupported-project-version',
      `repo-guard ESLint 预设要求安装 ESLint >=9.19；项目安装的是 ${eslintVersion}`,
    );
  }

  const js = await loadProjectEslintIntegration(root, '@eslint/js', '@eslint/js', true);
  const vue = await loadProjectEslintIntegration(
    root,
    'eslint-plugin-vue',
    'eslint-plugin-vue',
    false,
  );
  const typescript = await loadProjectEslintIntegration(
    root,
    'typescript-eslint',
    'typescript-eslint',
    false,
  );

  return {
    configs: createRepoGuardEslintConfig({
      js: js.module,
      vue: vue?.module ?? null,
      typescript: typescript?.module ?? null,
    }),
    integrations: [
      `@eslint/js ${js.version}`,
      ...(vue ? [`eslint-plugin-vue ${vue.version}`] : []),
      ...(typescript ? [`typescript-eslint ${typescript.version}`] : []),
    ],
  };
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

function blockingFindings(root, results, maxWarnings) {
  const warningCount = results.reduce((total, result) => total + result.warningCount, 0);
  const warningsAreBlocking = warningCount > maxWarnings;
  return results.flatMap((result) => result.messages
    .filter((message) => message.severity === 2 || (warningsAreBlocking && message.severity === 1))
    .map((message) => ({
      ruleId: `eslint/${message.ruleId || 'parsing-error'}`,
      severity: message.severity === 1 ? 'warning' : 'error',
      message: String(message.message).trim(),
      location: {
        path: path.relative(root, result.filePath).replace(/\\/g, '/'),
        ...(message.line ? { line: message.line } : {}),
        ...(message.column ? { column: message.column } : {}),
      },
      remediation: message.ruleId
        ? `修复 ESLint 规则报告的根因：${message.ruleId}，且不得禁用该规则。`
        : '修正语法或解析器配置，且不得削弱 ESLint 校验。',
    })));
}

export async function runEslintFiles({
  root,
  files,
  fix,
  maxWarnings,
  preset = false,
}) {
  if (files.length === 0) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'skipped', summary: 'ESLint 没有适用文件' });
  }

  const project = await loadProjectEslint(root);
  const repoGuardPreset = preset
    ? await resolveRepoGuardEslintPreset(root, project.version)
    : null;
  const execution = await prepareProjectEslintExecution({
    root,
    files,
    project,
    baseConfig: repoGuardPreset?.configs ?? null,
  });

  if (execution.lintableFiles.length === 0) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'skipped', summary: `ESLint ${project.version}：所有文件均被项目配置忽略` });
  }

  const initialResults = await execution.lint({ fix: false });
  const initialSummary = summarize(initialResults);
  if (!hasBlockingProblems(initialSummary, maxWarnings)) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'passed', summary: `ESLint ${project.version} 已通过`, metrics: { checkedFiles: execution.lintableFiles.length, errors: 0, warnings: initialSummary.warnings } });
  }

  if (!fix) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'violation', summary: `ESLint 发现 ${initialSummary.errors} 个错误和 ${initialSummary.warnings} 个警告`, findings: blockingFindings(root, initialResults, maxWarnings), metrics: { checkedFiles: execution.lintableFiles.length, errors: initialSummary.errors, warnings: initialSummary.warnings } });
  }

  const originalContents = captureFileContents(execution.lintableFiles);
  let finalResults;

  try {
    await execution.lint({ fix: true });
    finalResults = await execution.lint({ fix: false });
  } catch (error) {
    restoreFileContents(originalContents);
    throw toRepoGuardError(error, {
      kind: 'execution',
      code: 'eslint/execution-failed',
    });
  }

  const finalSummary = summarize(finalResults);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'violation', summary: `ESLint 自动修复后仍有 ${finalSummary.errors} 个错误和 ${finalSummary.warnings} 个警告`, findings: blockingFindings(root, finalResults, maxWarnings), metrics: { checkedFiles: execution.lintableFiles.length, errors: finalSummary.errors, warnings: finalSummary.warnings } });
  }

  return createGateResult({ gateId: ESLINT_GATE_ID, status: 'passed', summary: `ESLint ${project.version} 自动修复和校验已通过`, metrics: { checkedFiles: execution.lintableFiles.length, errors: 0, warnings: finalSummary.warnings } });
}
