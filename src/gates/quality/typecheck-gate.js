import { executionError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { executeProjectTypeCheck } from '../../integrations/npm/typecheck.js';

export const TYPE_CHECK_GATE_ID = 'quality.typecheck';

export function runTypeCheckGate({ root, config }) {
  const startedAt = Date.now();
  const { setup, execution } = executeProjectTypeCheck({ root, config });
  const diagnostics = [{
    level: 'info',
    message: `repo-guard TypeScript：正在运行 npm 脚本 "${config.script}" (${setup.command})...`,
  }];
  diagnostics.push(...processOutputDiagnostics(execution, { source: 'typescript', root }));
  if (execution.error) {
    const error = executionError(
      execution.timedOut ? 'typecheck/timeout' : 'typecheck/process-start-failed',
      execution.timedOut
        ? `TypeScript type check 超过 ${config.timeoutMs}ms`
        : `无法运行 TypeScript type check: ${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: TYPE_CHECK_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
      durationMs: Date.now() - startedAt,
    });
  }
  if (execution.status !== 0) {
    return createGateResult({
      gateId: TYPE_CHECK_GATE_ID,
      status: 'violation',
      summary: 'TypeScript 类型检查失败',
      diagnostics,
      findings: [processFailureFinding(TYPE_CHECK_GATE_ID, {
        exitCode: execution.status ?? 1,
        script: config.script,
      })],
      metrics: { processExitCode: execution.status ?? 1 },
      durationMs: Date.now() - startedAt,
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard TypeScript 已通过。' });
  return createGateResult({
    gateId: TYPE_CHECK_GATE_ID,
    status: 'passed',
    summary: 'TypeScript 类型检查已通过',
    diagnostics,
    durationMs: Date.now() - startedAt,
  });
}
