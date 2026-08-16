import { executionError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { terminalProcessOutput } from '../../core/execution/streaming-process.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  executeProjectBuild,
  validateBuildSetup,
} from '../../integrations/npm/build.js';

export const BUILD_GATE_ID = 'quality.build';

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
  const { execution } = await executeProjectBuild({
    root,
    config,
    signal,
    output: terminalProcessOutput(liveOutput),
  });
  const diagnostics = liveOutput ? [] : [{ level: 'info', message: progressMessage }];
  if (!liveOutput) {
    diagnostics.push(...processOutputDiagnostics(execution, { source: 'build', root }));
  }
  if (execution.error) {
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
      durationMs: Date.now() - startedAt,
    });
  }
  if (execution.status !== 0) {
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
      durationMs: Date.now() - startedAt,
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard 构建已通过。' });
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'passed',
    summary: '项目构建已通过',
    diagnostics,
    durationMs: Date.now() - startedAt,
  });
}
