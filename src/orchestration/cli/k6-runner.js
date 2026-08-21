import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { terminalProcessOutput } from '../../core/execution/streaming-process.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { runK6ExternalRunner } from '../../gates/testing/k6-external-runner.js';
import { findRepositoryRoot } from '../../git/repository.js';

const AUTOMATION_ENVIRONMENT_MARKERS = Object.freeze([
  'CI',
  'GITLAB_CI',
  'GITHUB_ACTIONS',
  'BUILD_BUILDID',
  'JENKINS_URL',
]);

function assertManualProcessEnvironment(environment) {
  const detected = AUTOMATION_ENVIRONMENT_MARKERS.filter((name) => {
    const value = environment[name];
    return typeof value === 'string'
      && value.trim() !== ''
      && !['0', 'false', 'no'].includes(value.trim().toLowerCase());
  });
  if (detected.length > 0) {
    throw configurationError(
      'k6-load/automated-environment-rejected',
      `k6 压测只能手动运行，检测到自动化环境标记：${detected.join('、')}`,
      {
        expected: 'k6 runner 只能在开发者显式启动的本地终端中运行。',
        remediation: {
          goal: '从本地终端手动执行 k6 外部门禁。',
          steps: ['退出 CI、流水线或自动构建环境，再运行 npm run guard:k6。'],
          constraints: ['不得删除流水线环境标记来伪装手动执行。'],
          verification: ['确认命令由本地终端显式启动，并且报告记录为本次新执行。'],
        },
      },
    );
  }
}

function manualOnlyGate(config, gateId) {
  const gate = config.externalGates.find(({ id }) => id === gateId);
  if (!gate) {
    throw configurationError('k6-load/external-gate-not-configured', `找不到 k6 压测外部门禁 ${gateId}`);
  }
  if (!gate.enabled) {
    throw configurationError('k6-load/external-gate-disabled', `k6 压测外部门禁 ${gateId} 已禁用`);
  }
  if (gate.environments.length !== 1 || gate.environments[0] !== 'manual') {
    throw configurationError(
      'k6-load/not-manual-only',
      `k6 压测外部门禁 ${gateId} 只能配置 environments: ["manual"]`,
      {
        expected: 'k6 压测只能由用户手动触发，不得进入 CI、发布、提交、推送或打包流程。',
      },
    );
  }
  return gate;
}

export async function runK6Runner({
  gateId,
  configFile,
  cwd = process.cwd(),
  environment = process.env,
  runtime,
  streamOutput = true,
}) {
  if (typeof gateId !== 'string' || !/^project\.[a-z][a-z0-9-]*$/.test(gateId)) {
    throw configurationError(
      'k6-load/invalid-gate-id',
      'k6-runner 需要有效的 --gate-id project.<kebab-case>',
    );
  }
  if (typeof configFile !== 'string' || !configFile.trim()) {
    throw configurationError('k6-load/missing-config', 'k6-runner 需要 --config 指定项目 k6 压测配置文件');
  }
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const gate = manualOnlyGate(config, gateId);
  assertManualProcessEnvironment(environment);
  if (streamOutput) writeConsoleMessage('第三方 k6 原始诊断：');
  const report = await runK6ExternalRunner({
    root,
    gateId,
    reportPath: gate.report.path,
    configFile,
    timeoutMs: gate.timeoutMs,
    environment,
    runtime,
    output: terminalProcessOutput(streamOutput),
  });
  writeConsoleMessage(report.summary, report.status === 'passed' ? 'stdout' : 'stderr');
  return report.status === 'passed' ? 0 : 2;
}
