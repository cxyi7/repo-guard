import { existsSync } from 'node:fs';
import { executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { terminalProcessOutput } from '../../core/execution/streaming-process.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { executeMutationTest } from '../../integrations/stryker/execution.js';
import {
  assertFreshMutationReport,
  mutationReportArtifacts,
  prepareMutationReportFiles,
} from '../../integrations/stryker/project.js';
import {
  readMutationReport,
  writeChineseMutationReport,
} from '../../integrations/stryker/report.js';

export const MUTATION_TEST_GATE_ID = 'quality.mutation-test';
const MAX_CONSOLE_FINDINGS = 100;

function mutationFinding(issue, severity) {
  const { filePath, mutant } = issue;
  const survived = mutant.status === 'Survived';
  const line = mutant.location.start.line;
  const column = mutant.location.start.column + 1;
  return {
    ruleId: survived ? 'mutation/survived' : 'mutation/no-coverage',
    code: survived ? 'mutation/survived-mutant' : 'mutation/uncovered-mutant',
    severity,
    message: survived
      ? `变异后测试仍然通过，需要补充能够观察该行为的断言：${mutant.mutatorName}`
      : `现有测试没有覆盖该变异位置：${mutant.mutatorName}`,
    location: { path: filePath, line, column },
    evidence: [{
      type: 'mutation-result',
      source: 'Stryker',
      message: `状态：${survived ? '存活' : '未覆盖'}；变异后代码：${String(mutant.replacement ?? '')}`,
      location: { path: filePath, line, column },
    }],
    expected: survived
      ? '生产代码发生该行为变化后，测试必须失败。'
      : '受变异代码路径必须由测试执行并验证。',
    remediation: {
      goal: survived ? '补充能够检出该变异的行为断言。' : '补充覆盖该代码路径的测试场景。',
      steps: ['根据中文变异测试报告定位原始代码、变异代码及对应业务边界。'],
      constraints: ['不得通过降低阈值、排除生产代码或删除断言绕过变异测试。'],
      verification: ['重新运行 repo-guard mutation-test，并确认该变异被检出。'],
    },
    decision: {
      aiAction: 'inspect-diagnostics-and-modify-code',
      humanApprovalRequired: false,
    },
  };
}

function resultMetrics(report, processExitCode) {
  return {
    mutationScore: report.metrics.score,
    totalMutants: report.metrics.total,
    detectedMutants: report.metrics.detected,
    survivedMutants: report.metrics.survived,
    uncoveredMutants: report.metrics.noCoverage,
    scoredMutants: report.metrics.scored,
    affectedFiles: report.files.length,
    ...(report.thresholds.break == null
      ? {}
      : { breakThreshold: report.thresholds.break }),
    processExitCode,
  };
}

function failureResult(error, startedAt, diagnostics = []) {
  const typedError = toRepoGuardError(error, {
    code: 'mutation-test/report-lifecycle-failed',
    message: `无法准备或读取变异测试报告：${error?.message ?? String(error)}`,
  });
  return createGateResult({
    gateId: MUTATION_TEST_GATE_ID,
    status: 'execution-error',
    summary: typedError.message,
    error: typedError,
    diagnostics,
    durationMs: Date.now() - startedAt,
  });
}

export async function runMutationTestGate({
  root,
  config,
  setup,
  signal = null,
  liveOutput = false,
}) {
  const startedAt = Date.now();
  let reports;
  try {
    reports = prepareMutationReportFiles(root, config);
  } catch (error) {
    return failureResult(error, startedAt);
  }
  const execution = await executeMutationTest({
    root,
    config,
    setup,
    reports,
    signal,
    output: terminalProcessOutput(liveOutput),
  });
  const diagnostics = liveOutput
    ? []
    : processOutputDiagnostics(execution, { source: 'Stryker 原始诊断', root });
  if (execution.error && !existsSync(reports.json)) {
    const error = executionError(
      execution.timedOut ? 'mutation-test/timeout' : 'mutation-test/process-start-failed',
      execution.timedOut
        ? `变异测试超过 ${config.timeoutMs}ms，已终止执行`
        : `无法运行 Stryker：${execution.error.message}`,
      { cause: execution.error },
    );
    return failureResult(error, startedAt, diagnostics);
  }

  let report;
  try {
    assertFreshMutationReport(root, reports.json, startedAt);
    if (config.originalHtml) {
      assertFreshMutationReport(root, reports.originalHtml, startedAt, '原始 HTML');
    }
    report = readMutationReport(reports.json);
    writeChineseMutationReport(reports.chineseHtml, report, {
      includeOriginalHtml: config.originalHtml,
    });
  } catch (error) {
    return failureResult(error, startedAt, diagnostics);
  }

  const noScoredMutants = report.metrics.scored === 0;
  const missingBreakThreshold = report.thresholds.break == null;
  const thresholdFailed = noScoredMutants
    || missingBreakThreshold
    || report.metrics.score < report.thresholds.break;
  const processExitCode = execution.status ?? 1;
  const artifacts = mutationReportArtifacts(root, reports, config.originalHtml);
  if (execution.error) {
    const error = executionError(
      execution.timedOut ? 'mutation-test/timeout' : 'mutation-test/process-failed',
      execution.timedOut
        ? `变异测试超过 ${config.timeoutMs}ms，已终止执行`
        : `Stryker 执行失败：${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: MUTATION_TEST_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
      artifacts,
      metrics: resultMetrics(report, processExitCode),
      durationMs: Date.now() - startedAt,
    });
  }
  if (processExitCode !== 0 && !thresholdFailed) {
    const error = executionError(
      'mutation-test/unexpected-process-failure',
      `Stryker 退出码为 ${processExitCode}，但报告中的变异得分没有触发硬门槛`,
    );
    return createGateResult({
      gateId: MUTATION_TEST_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
      artifacts,
      metrics: resultMetrics(report, processExitCode),
      durationMs: Date.now() - startedAt,
    });
  }

  const findings = [
    ...(noScoredMutants ? [{
      ruleId: 'mutation/no-scored-mutants',
      code: 'mutation/no-scored-mutants',
      severity: 'error',
      message: 'Stryker 报告中没有可评分的变异，无法证明测试能够发现生产代码变化',
      expected: '变异测试至少生成一个已执行且可评分的变异。',
      remediation: {
        goal: '修正 Stryker 的 mutate 范围、测试运行器或忽略设置，使生产代码产生可评分变异。',
        steps: ['检查 Stryker 配置和原始诊断，再重新运行 repo-guard mutation-test。'],
        constraints: ['不得使用空 mutate 范围或全部忽略规则绕过变异测试。'],
        verification: ['确认中文报告中的可评分变异数量大于 0。'],
      },
      decision: {
        aiAction: 'inspect-diagnostics-and-modify-code',
        humanApprovalRequired: false,
      },
    }] : []),
    ...(missingBreakThreshold ? [{
      ruleId: 'mutation/missing-break-threshold',
      code: 'mutation/missing-break-threshold',
      severity: 'error',
      message: 'Stryker 报告未配置 thresholds.break，无法形成构建前硬门槛',
      expected: 'Stryker thresholds.break 必须配置为 0 到 100 之间的数值。',
      remediation: {
        goal: '在消费项目的 Stryker 配置中设置明确的变异得分硬门槛。',
        steps: ['配置 thresholds.break 后重新运行 repo-guard mutation-test。'],
        constraints: ['不得通过省略 thresholds.break 绕过变异得分要求。'],
        verification: ['确认中文报告显示硬门槛，并且实际得分达到该门槛。'],
      },
      decision: {
        aiAction: 'update-configuration',
        humanApprovalRequired: false,
      },
    }] : []),
    ...report.issues
    .slice(0, MAX_CONSOLE_FINDINGS)
    .map((issue) => mutationFinding(issue, thresholdFailed ? 'error' : 'warning')),
  ];
  const resultDiagnostics = report.issues.length > MAX_CONSOLE_FINDINGS
    ? [...diagnostics, {
      level: 'warn',
      message: `控制台仅显示前 ${MAX_CONSOLE_FINDINGS} 个变异问题；完整内容请查看中文报告。`,
    }]
    : diagnostics;
  return createGateResult({
    gateId: MUTATION_TEST_GATE_ID,
    status: thresholdFailed ? 'violation' : 'passed',
    summary: thresholdFailed
      ? (noScoredMutants
        ? '变异测试没有产生可评分变异，已阻断后续构建'
        : (missingBreakThreshold
          ? 'Stryker 未配置 thresholds.break，已阻断后续构建'
          : `变异得分 ${report.metrics.score.toFixed(2)}% 未达到硬门槛 ${report.thresholds.break}%`))
      : `变异测试已通过，得分 ${report.metrics.score.toFixed(2)}%`,
    findings,
    diagnostics: resultDiagnostics,
    artifacts,
    metrics: resultMetrics(report, processExitCode),
    durationMs: Date.now() - startedAt,
  });
}
