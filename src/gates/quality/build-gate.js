import { executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { terminalProcessOutput } from '../../core/execution/streaming-process.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  executeProjectBuildClean,
  executeProjectBuild,
  validateBuildSetup,
} from '../../integrations/npm/build.js';
import {
  buildArtifactOutputIsEmpty,
  createStaleOutputSentinel,
  removeStaleOutputSentinel,
  resolveBuildArtifactOutput,
  staleOutputSentinelExists,
} from '../../integrations/build-artifacts/project.js';
import {
  describeBuildArtifactPlatform,
  evaluateBuildArtifactBudget,
} from './build-artifact-budget.js';

export const BUILD_GATE_ID = 'quality.build';

function durationSince(startedAt) {
  return Date.now() - startedAt;
}

function cleanExecutionFailure(cleanExecution, config, startedAt) {
  if (cleanExecution?.error) {
    const error = executionError(
      cleanExecution.timedOut ? 'build/clean-timeout' : 'build/clean-process-start-failed',
      cleanExecution.timedOut
        ? `产物清理超过 ${config.timeoutMs}ms`
        : `无法运行产物清理：${cleanExecution.error.message}`,
      { cause: cleanExecution.error },
    );
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      durationMs: durationSince(startedAt),
    });
  }
  if (cleanExecution?.status !== undefined && cleanExecution.status !== 0) {
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'violation',
      summary: '构建产物清理失败',
      findings: [processFailureFinding(BUILD_GATE_ID, {
        exitCode: cleanExecution.status ?? 1,
        script: config.artifactBudget.cleanScript,
      })],
      metrics: { processExitCode: cleanExecution.status ?? 1 },
      durationMs: durationSince(startedAt),
    });
  }
  return null;
}

function staleOutputAfterCleanResult(config, startedAt) {
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'violation',
    summary: '构建产物清理脚本未清空旧产物',
    findings: [{
      ruleId: 'build-artifact/stale-output-after-clean',
      severity: 'error',
      message: `清理脚本 ${config.artifactBudget.cleanScript} 未清空构建产物目录`,
      location: { path: config.artifactBudget.outputDirectory },
      remediation: {
        goal: '让清理脚本完整删除当前平台的旧构建产物。',
        steps: ['修正 cleanScript 对应 npm 脚本，使其只清空配置的 outputDirectory。'],
        constraints: ['不得扩大到仓库根目录、src 或其他业务目录。'],
        verification: ['重新运行 repo-guard build 并确认清理探针消失。'],
      },
    }],
    durationMs: durationSince(startedAt),
  });
}

function nonemptyOutputAfterCleanResult(config, startedAt) {
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'violation',
    summary: '构建产物清理脚本仍保留旧文件',
    findings: [{
      ruleId: 'build-artifact/nonempty-output-after-clean',
      severity: 'error',
      message: `清理脚本 ${config.artifactBudget.cleanScript} 执行后产物目录仍不为空`,
      location: { path: config.artifactBudget.outputDirectory },
      remediation: {
        goal: '让清理脚本完整清空当前平台的旧构建产物。',
        steps: ['修正 cleanScript 对应 npm 脚本，使产物目录在构建开始前为空或不存在。'],
        constraints: ['不得只删除 repo-guard 探针而保留其他旧文件。'],
        verification: ['重新运行 repo-guard build 并确认清理后目录为空。'],
      },
    }],
    durationMs: durationSince(startedAt),
  });
}

async function prepareBuildArtifactOutput({ root, config, signal, output, startedAt }) {
  if (!config.artifactBudget?.enabled) return Object.freeze({ sentinelSetup: null, result: null });
  resolveBuildArtifactOutput(root, config.artifactBudget);
  const sentinelSetup = createStaleOutputSentinel(root, config.artifactBudget);
  let cleanExecution;
  try {
    cleanExecution = await executeProjectBuildClean({ root, config, signal, output });
  } catch (error) {
    removeStaleOutputSentinel(sentinelSetup?.sentinel);
    throw toRepoGuardError(error, {
      code: 'build/unexpected-clean-execution-failure',
      message: `构建产物清理执行异常：${error.message}`,
    });
  }
  const failure = cleanExecutionFailure(cleanExecution, config, startedAt);
  if (failure) {
    removeStaleOutputSentinel(sentinelSetup?.sentinel);
    return Object.freeze({ sentinelSetup, result: failure });
  }
  if (cleanExecution && staleOutputSentinelExists(sentinelSetup?.sentinel)) {
    removeStaleOutputSentinel(sentinelSetup.sentinel);
    return Object.freeze({ sentinelSetup, result: staleOutputAfterCleanResult(config, startedAt) });
  }
  if (cleanExecution && !buildArtifactOutputIsEmpty(root, config.artifactBudget)) {
    return Object.freeze({ sentinelSetup, result: nonemptyOutputAfterCleanResult(config, startedAt) });
  }
  return Object.freeze({ sentinelSetup, result: null });
}

async function executeBuildPhase({ root, config, signal, output, sentinelSetup }) {
  try {
    return await executeProjectBuild({ root, config, signal, output });
  } catch (error) {
    removeStaleOutputSentinel(sentinelSetup?.sentinel);
    throw toRepoGuardError(error, {
      code: 'build/unexpected-execution-failure',
      message: `项目构建执行异常：${error.message}`,
    });
  }
}

function buildExecutionFailure(execution, config, diagnostics, sentinelSetup, startedAt) {
  if (execution.error) {
    removeStaleOutputSentinel(sentinelSetup?.sentinel);
    const error = executionError(
      execution.timedOut ? 'build/timeout' : 'build/process-start-failed',
      execution.timedOut
        ? `项目构建超过 ${config.timeoutMs}ms`
        : `无法运行项目构建： ${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
      durationMs: durationSince(startedAt),
    });
  }
  if (execution.status !== 0) {
    removeStaleOutputSentinel(sentinelSetup?.sentinel);
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'violation',
      summary: '项目构建失败',
      diagnostics,
      findings: [processFailureFinding(BUILD_GATE_ID, {
        exitCode: execution.status ?? 1,
        script: config.script,
      })],
      metrics: { processExitCode: execution.status ?? 1 },
      durationMs: durationSince(startedAt),
    });
  }
  return null;
}

function staleOutputAfterBuildResult(config, diagnostics, sentinelSetup, startedAt) {
  if (!config.artifactBudget?.enabled || !staleOutputSentinelExists(sentinelSetup?.sentinel)) {
    return null;
  }
  removeStaleOutputSentinel(sentinelSetup.sentinel);
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'violation',
    summary: '构建脚本未清理旧产物',
    diagnostics,
    findings: [{
      ruleId: 'build-artifact/stale-output',
      severity: 'error',
      message: `构建脚本保留了旧产物；请让 ${config.script} 清理输出目录，或配置精确的 cleanScript`,
      location: { path: config.artifactBudget.outputDirectory },
      remediation: {
        goal: '确保每次预算分析只读取本次构建生成的完整产物。',
        steps: ['让构建脚本先清空输出目录，或配置只清理该产物目录的 npm cleanScript。'],
        constraints: ['不得让 repo-guard 删除业务目录，也不得忽略陈旧产物探针。'],
        verification: ['重新运行 repo-guard build 并确认旧产物探针被构建流程清除。'],
      },
    }],
    durationMs: durationSince(startedAt),
  });
}

function buildArtifactBudgetResult(root, config, diagnostics, startedAt) {
  const evaluation = evaluateBuildArtifactBudget(root, config.artifactBudget);
  const findings = evaluation.violations.map(({ finding }) => finding);
  const blocking = findings.some(({ severity }) => severity === 'error');
  diagnostics.push({
    level: blocking ? 'error' : findings.length > 0 ? 'warn' : 'info',
    message: findings.length > 0
      ? `构建产物预算发现 ${findings.length} 个问题，历史债务 ${evaluation.baselineDebt} 项`
      : `构建产物预算已通过，历史债务 ${evaluation.baselineDebt} 项`,
  });
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: blocking ? 'violation' : 'passed',
    summary: blocking
      ? `构建产物预算发现 ${findings.length} 个阻断问题`
      : findings.length > 0
        ? `构建已通过，产物预算报告 ${findings.length} 个问题`
        : '构建及产物预算已通过',
    diagnostics,
    findings,
    artifacts: [{
      path: config.artifactBudget.outputDirectory,
      type: `${config.artifactBudget.platform}-build-artifacts`,
      description: describeBuildArtifactPlatform(config.artifactBudget.platform),
    }],
    metrics: { ...evaluation.inspection.metrics, baselineDebt: evaluation.baselineDebt },
    durationMs: durationSince(startedAt),
  });
}

export async function runBuildGate({
  root,
  config,
  signal = null,
  liveOutput = false,
  writeProgress = null,
}) {
  const startedAt = Date.now();
  const setup = validateBuildSetup(root, config);
  const progressMessage = `repo-guard 构建：正在运行 npm 脚本 "${config.script}" (${setup.command})...`;
  if (liveOutput) writeProgress?.(progressMessage);
  const output = terminalProcessOutput(liveOutput);
  const diagnostics = liveOutput ? [] : [{ level: 'info', message: progressMessage }];
  const preparation = await prepareBuildArtifactOutput({
    root, config, signal, output, startedAt,
  });
  if (preparation.result) return preparation.result;

  const { execution } = await executeBuildPhase({
    root, config, signal, output, sentinelSetup: preparation.sentinelSetup,
  });
  if (!liveOutput) diagnostics.push(...processOutputDiagnostics(execution, { source: 'build', root }));
  const executionFailure = buildExecutionFailure(
    execution, config, diagnostics, preparation.sentinelSetup, startedAt,
  );
  if (executionFailure) return executionFailure;

  const staleOutput = staleOutputAfterBuildResult(
    config, diagnostics, preparation.sentinelSetup, startedAt,
  );
  if (staleOutput) return staleOutput;
  removeStaleOutputSentinel(preparation.sentinelSetup?.sentinel);

  if (config.artifactBudget?.enabled) {
    return buildArtifactBudgetResult(root, config, diagnostics, startedAt);
  }
  diagnostics.push({ level: 'info', message: 'repo-guard 构建已通过。' });
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'passed',
    summary: '项目构建已通过',
    diagnostics,
    durationMs: durationSince(startedAt),
  });
}
