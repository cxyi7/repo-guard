import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { runApiPerformanceExternalRunner } from '../../gates/testing/api-performance-external-runner.js';
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
      'api-performance/automated-environment-rejected',
      `接口性能测试只能手动运行，检测到自动化环境标记：${detected.join('、')}`,
      {
        expected: '接口性能 runner 只能在开发者显式启动的本地终端中运行。',
        remediation: {
          goal: '从本地终端手动执行接口性能外部门禁。',
          steps: ['退出 CI、流水线或自动构建环境，再运行 npm run guard:api-performance。'],
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
    throw configurationError(
      'api-performance/external-gate-not-configured',
      `找不到接口性能外部门禁 ${gateId}`,
    );
  }
  if (!gate.enabled) {
    throw configurationError('api-performance/external-gate-disabled', `接口性能外部门禁 ${gateId} 已禁用`);
  }
  if (gate.environments.length !== 1 || gate.environments[0] !== 'manual') {
    throw configurationError(
      'api-performance/not-manual-only',
      `接口性能外部门禁 ${gateId} 只能配置 environments: ["manual"]`,
      {
        expected: '接口性能测试只能由用户手动触发，不得进入 CI、发布、提交、推送或打包流程。',
      },
    );
  }
  return gate;
}

export async function runApiPerformanceRunner({
  gateId,
  configFile,
  cwd = process.cwd(),
  environment = process.env,
}) {
  if (typeof gateId !== 'string' || !/^project\.[a-z][a-z0-9-]*$/.test(gateId)) {
    throw configurationError(
      'api-performance/invalid-gate-id',
      'api-performance-runner 需要有效的 --gate-id project.<kebab-case>',
    );
  }
  if (typeof configFile !== 'string' || !configFile.trim()) {
    throw configurationError(
      'api-performance/missing-config',
      'api-performance-runner 需要 --config 指定项目性能测试配置文件',
    );
  }
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const gate = manualOnlyGate(config, gateId);
  assertManualProcessEnvironment(environment);
  const report = await runApiPerformanceExternalRunner({
    root,
    gateId,
    reportPath: gate.report.path,
    configFile,
    environment,
  });
  writeConsoleMessage(report.summary, report.status === 'passed' ? 'stdout' : 'stderr');
  return report.status === 'passed' ? 0 : 2;
}
