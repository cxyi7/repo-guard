import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { gateResultToExitCode } from '../../core/result/gate-result.js';
import { writeConsoleMessage, writeGateResultConsole } from '../../core/report/console-renderer.js';
import { runBuildGate } from '../../gates/quality/build-gate.js';
import { sendMutationTestFailureNotification } from '../../gates/release/mutation-test-notification.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { runRegisteredManualGate } from './manual-gates.js';

function configuredBuild(config, script) {
  const build = config.mutationTest.guardedBuilds.find((entry) => entry.script === script);
  if (!build) {
    throw configurationError(
      'guarded-build/not-configured',
      `npm 脚本 ${script} 未在 mutationTest.guardedBuilds 中声明`,
    );
  }
  return build;
}

async function notifyFailure(root, config, build, result, environment, send) {
  const status = await sendMutationTestFailureNotification({
    root, config, build, result, environment, send,
  });
  if (status === 'managed-pipeline') {
    writeConsoleMessage('受管 GitLab 流水线将发送统一失败通知，本次不重复发送企业微信消息。');
    return;
  }
  if (status === 'sent') writeConsoleMessage('变异测试失败通知已发送到企业微信。');
}

export async function runGuardedBuild(script, {
  cwd = process.cwd(),
  environment = process.env,
  send = undefined,
} = {}) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const build = configuredBuild(config, script);
  if (!config.mutationTest.enabled) {
    throw configurationError(
      'guarded-build/mutation-test-disabled',
      '受保护构建要求启用 mutationTest.enabled，已拒绝绕过变异测试执行构建',
    );
  }
  const mutationResult = await runRegisteredManualGate('mutation-test', [], root);
  if (mutationResult.status !== 'passed') {
    try {
      await notifyFailure(root, config, build, mutationResult, environment, send);
    } catch (error) {
      writeConsoleMessage(`企业微信通知失败：${error.message}`, 'stderr');
    }
    return gateResultToExitCode(mutationResult);
  }
  const buildResult = await runBuildGate({
    root,
    config: { enabled: true, script: build.script, timeoutMs: build.timeoutMs },
    liveOutput: true,
  });
  writeGateResultConsole(buildResult, { label: build.packageScript });
  return gateResultToExitCode(buildResult);
}
