import { resolveBuildArtifactOutput } from '../../integrations/build-artifacts/project.js';
import { outputFingerprint } from '../../integrations/build-artifacts/evidence.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { prepareLighthouseConfiguration } from '../../integrations/lighthouse/configuration.js';
import { inspectLighthouseReports } from '../../integrations/lighthouse/reports.js';
import { saveLighthouseRun } from '../../integrations/lighthouse/run-journal.js';
import { errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { currentBuildEvidence } from '../../integrations/build-artifacts/evidence.js';
import { runBuildGate } from './build-gate.js';
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

async function executeVueLighthouse({ root, config, skipBuild = false, setup, signal, prepared, buildEvidence }) {
  const startedAt = Date.now();
  resolveBuildArtifactOutput(root, { outputDirectory: '.lighthouseci' });
  outputFingerprint(root, '.lighthouseci');
  const diagnostics = [{ level: 'info', message:
    `repo-guard Lighthouse：Vue 项目，@lhci/cli ${setup.lighthouse.version}, `
    + `配置=${setup.configFile}` }];

  const resultForExecutionFailure = (execution, label) => {
    if (!execution.error && !execution.signal && !execution.timedOut) return null;
    const error = executionError(
      (execution.timedOut || execution.error?.code === 'ETIMEDOUT')
        ? 'lighthouse/process-timeout'
        : execution.signal ? 'lighthouse/process-signal' : 'lighthouse/process-start-failed',
      execution.timedOut || execution.error?.code === 'ETIMEDOUT'
        ? `${label} 超过 ${config.timeoutMs}ms`
        : execution.signal ? `${label} 被信号 ${execution.signal} 终止。` : `无法运行 ${label}: ${execution.error.message}`,
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
    const execution = await runLighthouseBuild(root, config.buildScript, config.timeoutMs, signal);
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
  const collectExecution = await runLighthousePhase(
    root,
    setup.lighthouse,
    setup.configFile,
    'collect',
    config.timeoutMs,
    signal,
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

  let summaryArtifact;
  try {
    summaryArtifact = prepared && config.pages ? inspectLighthouseReports(root, config, prepared.effective, startedAt, buildEvidence, prepared.observationsFile) : null;
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'lighthouse/report-inspection-failed', message: 'Lighthouse 报告检查失败，请查看本次独立诊断。' });
    return createGateResult({ gateId: 'quality.lighthouse', status: errorStatus(error), summary: error.message, error, diagnostics });
  }
  const imageFindings = summaryArtifact?.imageFindings ?? [];
  if (summaryArtifact) delete summaryArtifact.imageFindings;
  diagnostics.push({ level: 'info', message: 'repo-guard Lighthouse：正在检查项目断言...' });
  const assertExecution = await runLighthousePhase(
    root,
    setup.lighthouse,
    setup.configFile,
    'assert',
    config.timeoutMs,
    signal,
  );
  diagnostics.push(...processOutputDiagnostics(assertExecution, { source: 'lighthouse-assert', root }));
  const failedAssertion = resultForExecutionFailure(assertExecution, 'Lighthouse 断言');
  if (failedAssertion) return failedAssertion;
  const assertExitCode = assertExecution.status ?? 1;
  if (assertExitCode !== 0 || imageFindings.some((finding) => finding.severity === 'error')) {
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'violation',
      summary: assertExitCode !== 0 ? `Lighthouse 断言失败，退出码为 ${assertExitCode}` : '页面图片检查发现阻断问题',
      artifacts: summaryArtifact ? [summaryArtifact] : [],
      diagnostics,
      findings: [...imageFindings, ...(assertExitCode !== 0 ? [processFailureFinding('quality.lighthouse', {
        exitCode: assertExitCode,
        phase: 'assert',
      })] : [])],
    });
  }

  diagnostics.push({ level: 'info', message: `repo-guard Lighthouse 已通过。原始报告： ${path.join(root, '.lighthouseci')}` });
  return createGateResult({
    gateId: 'quality.lighthouse',
    status: 'passed',
    summary: 'Lighthouse 断言已通过',
    findings: imageFindings,
    diagnostics,
    artifacts: [...(summaryArtifact ? [summaryArtifact] : []), {
      path: path.relative(root, path.join(root, '.lighthouseci')).replace(/\\/g, '/'),
      type: 'lighthouse-report',
      description: '本地 Lighthouse CI 报告',
    }],
  });
}

/** 自动复用只接受本进程中通过验证且指纹仍一致的构建。 */
async function runLighthouse({ root, config, skipBuild = false, buildConfig = null, stylelintConfig = null, exceptionsConfig = null, signal = null }) {
  const setup = validateVueLighthouseSetup(root, config);
  let evidence = buildConfig && currentBuildEvidence(root, buildConfig, stylelintConfig);
  if (evidence?.script !== config.buildScript) evidence = null;
  if (skipBuild && !evidence) throw configurationError('lighthouse/unverified-skip-build', '没有可验证的本轮构建，不能跳过构建；请执行完整构建与 Lighthouse 流程。');
  const prepared = config.options || config.pages || config.imageUsage?.enabled ? await prepareLighthouseConfiguration(root, config, setup.configFile) : null;
  try {
    if (!evidence && buildConfig && config.buildScript) {
      const selected = { ...buildConfig, script: config.buildScript };
      const build = await runBuildGate({ root, config: selected, stylelintConfig, exceptionsConfig, signal, requireEvidence: Boolean(config.pages) });
      if (build.status !== 'passed') return createGateResult({ ...build, gateId: 'quality.lighthouse', summary: `Lighthouse 前置构建未通过：${build.summary}` });
      evidence = currentBuildEvidence(root, selected, stylelintConfig);
      // 无产物预算的已有项目仍完成真实构建，但不登记跨阶段复用。
      skipBuild = true;
    }
    if (config.pages && (!config.buildScript || !evidence)) throw configurationError('lighthouse/unverified-artifacts', 'Lighthouse 页面验证要求本轮已验证的生产构建产物。');
    const result = await executeVueLighthouse({ root, config, signal, setup: { ...setup, configFile: prepared?.configFile ?? setup.configFile },
      prepared, buildEvidence: evidence, skipBuild: skipBuild || Boolean(evidence) });
    if (evidence && !currentBuildEvidence(root, { ...buildConfig, script: config.buildScript }, stylelintConfig)) throw executionError('lighthouse/inputs-changed', '页面检测期间源码、配置或产物发生变化，请重新执行。');
    return result;
  } finally { prepared?.dispose(); }
}

/** 保留成功和失败结果；配置异常仍交由统一入口处理。 */
export async function runVueLighthouse(options) {
  const startedAt = Date.now();
  let result;
  try {
    result = await runLighthouse(options);
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'lighthouse/execution-failed', message: 'Lighthouse 执行失败，请查看本次独立诊断。' });
    saveLighthouseRun(options.root, createGateResult({ gateId: 'quality.lighthouse', status: errorStatus(error), summary: error.message, error }), startedAt);
    throw toRepoGuardError(error);
  }
  return saveLighthouseRun(options.root, result, startedAt);
}
