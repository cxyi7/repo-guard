import { executionError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { executeProjectBuild } from '../../integrations/npm/build.js';

export const BUILD_GATE_ID = 'quality.build';

export function runBuildGate({ root, config }) {
  const startedAt = Date.now();
  const { setup, execution } = executeProjectBuild({ root, config });
  const diagnostics = [{
    level: 'info',
    message: `repo-guard build: running npm script "${config.script}" (${setup.command})...`,
  }];
  diagnostics.push(...processOutputDiagnostics(execution, { source: 'build', root }));
  if (execution.error) {
    const error = executionError(
      execution.timedOut ? 'build/timeout' : 'build/process-start-failed',
      execution.timedOut
        ? `Project build exceeded ${config.timeoutMs}ms`
        : `Unable to run project build: ${execution.error.message}`,
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
      summary: 'Project build failed',
      diagnostics,
      findings: [processFailureFinding(BUILD_GATE_ID, {
        exitCode: execution.status ?? 1,
        script: config.script,
      })],
      metrics: { processExitCode: execution.status ?? 1 },
      durationMs: Date.now() - startedAt,
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard build passed.' });
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'passed',
    summary: 'Project build passed',
    diagnostics,
    durationMs: Date.now() - startedAt,
  });
}
