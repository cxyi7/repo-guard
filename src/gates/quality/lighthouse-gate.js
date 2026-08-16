import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  runLighthouseBuild,
  runLighthousePhase,
} from '../../integrations/lighthouse/execution.js';
import { validateVueLighthouseSetup } from '../../integrations/lighthouse/project.js';

export function runVueLighthouse({ root, config, skipBuild = false }) {
  const setup = validateVueLighthouseSetup(root, config);
  const diagnostics = [{ level: 'info', message:
    `repo-guard Lighthouse：Vue 项目，@lhci/cli ${setup.lighthouse.version}, `
    + `配置=${setup.configFile}` }];

  const resultForExecutionFailure = (execution, label) => {
    if (!execution.error) return null;
    const error = executionError(
      execution.error.code === 'ETIMEDOUT'
        ? 'lighthouse/process-timeout'
        : 'lighthouse/process-start-failed',
      execution.error.code === 'ETIMEDOUT'
        ? `${label} 超过 ${config.timeoutMs}ms`
        : `无法运行 ${label}: ${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
    });
  };

  if (!skipBuild && config.buildScript) {
    diagnostics.push({ level: 'info', message: `repo-guard Lighthouse：正在运行 npm 脚本 "${config.buildScript}"...` });
    const execution = runLighthouseBuild(root, config.buildScript, config.timeoutMs);
    diagnostics.push(...processOutputDiagnostics(execution, { source: 'lighthouse-build', root }));
    const failedExecution = resultForExecutionFailure(execution, 'Lighthouse 构建');
    if (failedExecution) return failedExecution;
    const buildExitCode = execution.status ?? 1;
    if (buildExitCode !== 0) {
      return createGateResult({
        gateId: 'quality.lighthouse',
        status: 'violation',
        summary: `Lighthouse 构建失败，退出码为 ${buildExitCode}`,
        diagnostics,
        findings: [processFailureFinding('quality.lighthouse', {
          exitCode: buildExitCode,
          phase: 'build',
          script: config.buildScript,
        })],
      });
    }
  }

  diagnostics.push({ level: 'info', message: 'repo-guard Lighthouse：正在采集已配置的 Vue 页面结果...' });
  const collectExecution = runLighthousePhase(
    root,
    setup.lighthouse,
    setup.configFile,
    'collect',
    config.timeoutMs,
  );
  diagnostics.push(...processOutputDiagnostics(collectExecution, { source: 'lighthouse-collect', root }));
  const failedCollection = resultForExecutionFailure(collectExecution, 'Lighthouse 采集');
  if (failedCollection) return failedCollection;
  const collectExitCode = collectExecution.status ?? 1;
  if (collectExitCode !== 0) {
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'execution-error',
      summary: `Lighthouse 采集失败，退出码为 ${collectExitCode}`,
      error: executionError(
        'lighthouse/collect-failed',
        `LHCI collect 退出码为 ${collectExitCode}`,
      ),
      diagnostics,
      findings: [processFailureFinding('quality.lighthouse', {
        exitCode: collectExitCode,
        phase: 'collect',
      })],
    });
  }

  diagnostics.push({ level: 'info', message: 'repo-guard Lighthouse：正在检查项目断言...' });
  const assertExecution = runLighthousePhase(
    root,
    setup.lighthouse,
    setup.configFile,
    'assert',
    config.timeoutMs,
  );
  diagnostics.push(...processOutputDiagnostics(assertExecution, { source: 'lighthouse-assert', root }));
  const failedAssertion = resultForExecutionFailure(assertExecution, 'Lighthouse 断言');
  if (failedAssertion) return failedAssertion;
  const assertExitCode = assertExecution.status ?? 1;
  if (assertExitCode !== 0) {
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'violation',
      summary: `Lighthouse 断言失败，退出码为 ${assertExitCode}`,
      diagnostics,
      findings: [processFailureFinding('quality.lighthouse', {
        exitCode: assertExitCode,
        phase: 'assert',
      })],
    });
  }

  diagnostics.push({ level: 'info', message: `repo-guard Lighthouse 已通过。原始报告： ${path.join(root, '.lighthouseci')}` });
  return createGateResult({
    gateId: 'quality.lighthouse',
    status: 'passed',
    summary: 'Lighthouse 断言已通过',
    diagnostics,
    artifacts: [{
      path: path.relative(root, path.join(root, '.lighthouseci')).replace(/\\/g, '/'),
      type: 'lighthouse-report',
      description: '本地 Lighthouse CI 报告',
    }],
  });
}
