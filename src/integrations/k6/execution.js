import { randomUUID } from 'node:crypto';
import { executionError } from '../../core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../core/execution/streaming-process.js';

const MINIMUM_K6_VERSION = Object.freeze([1, 5, 0]);
const MAXIMUM_K6_MAJOR = 2;
const OPERATING_SYSTEM_ENVIRONMENT = Object.freeze([
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
]);

function versionTuple(value) {
  const match = String(value).match(/\bv?(\d+)\.(\d+)\.(\d+)\b/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function executionFailure(code, message, execution, details = {}) {
  return executionError(`k6-load/${code}`, message, {
    cause: execution?.error instanceof Error ? execution.error : undefined,
    details: {
      ...details,
      process: execution ? {
        status: execution.status,
        signal: execution.signal,
        timedOut: execution.timedOut,
      } : null,
    },
    expected: '本地 k6 二进制应在受控环境和时限内完成脚本预检与压测。',
    remediation: {
      goal: '修复 k6 安装、脚本或测试环境后重新手动运行。',
      steps: ['检查第三方 k6 原始诊断、脚本语法、网络连接和超时设置。'],
      constraints: ['不得切换到 k6 cloud、放宽负载确认或传递未审核的 K6_* 配置。'],
      verification: ['运行 k6 version 后重新执行 npm run guard:k6。'],
    },
  });
}

function childEnvironment(configuration, environment, runId) {
  const child = {};
  for (const name of OPERATING_SYSTEM_ENVIRONMENT) {
    if (typeof environment[name] === 'string') child[name] = environment[name];
  }
  for (const name of configuration.environment.pass) child[name] = environment[name];
  child[configuration.target.baseUrlEnv] = configuration.resolvedTarget.baseURL;
  child.REPO_GUARD_K6_RUN_ID = runId;
  child.K6_NO_USAGE_REPORT = 'true';
  child.K6_AUTO_EXTENSION_RESOLUTION = 'false';
  return Object.freeze(child);
}

async function invoke(runtime, argumentsList, {
  root,
  env,
  timeoutMs,
  output = null,
}) {
  return await runStreamingProcess({
    command: runtime.command,
    argumentsList: [...runtime.prefixArguments, ...argumentsList],
    root,
    env,
    timeoutMs,
    output,
  });
}

function remainingTime(deadline, phase) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw executionFailure('timeout', `k6 ${phase} 前已耗尽受控执行时限`);
  }
  return remaining;
}

export async function inspectK6Runtime({
  root,
  runtime = Object.freeze({ command: 'k6', prefixArguments: Object.freeze([]) }),
  environment = process.env,
  timeoutMs = 30000,
}) {
  const execution = await invoke(runtime, ['version'], {
    root,
    env: childEnvironment({
      environment: { pass: [] },
      target: { baseUrlEnv: 'REPO_GUARD_K6_BASE_URL' },
      resolvedTarget: { baseURL: 'https://invalid.example/' },
    }, environment, 'runtime-inspection'),
    timeoutMs,
  });
  if (execution.error || execution.status !== 0) {
    throw executionFailure(
      'runtime-not-available',
      '找不到可执行的本地 k6，或 k6 version 执行失败',
      execution,
    );
  }
  const version = versionTuple(`${execution.stdout}\n${execution.stderr}`);
  if (!version) {
    throw executionFailure('unrecognized-version', '无法识别本地 k6 版本', execution);
  }
  if (compareVersions(version, MINIMUM_K6_VERSION) < 0 || version[0] > MAXIMUM_K6_MAJOR) {
    throw executionFailure(
      'unsupported-version',
      `本地 k6 版本必须介于 1.5.0 和 2.x；当前为 ${version.join('.')}`,
      execution,
    );
  }
  return Object.freeze({
    runtime,
    version: version.join('.'),
    major: version[0],
  });
}

export async function executeK6LoadTest({
  root,
  configuration,
  reports,
  timeoutMs,
  environment = process.env,
  runtime,
  output = null,
}) {
  const deadline = Date.now() + timeoutMs;
  const runtimeInfo = await inspectK6Runtime({
    root,
    runtime,
    environment,
    timeoutMs: Math.min(30000, remainingTime(deadline, '版本检查')),
  });
  const runId = randomUUID();
  const env = childEnvironment(configuration, environment, runId);
  const inspection = await invoke(runtimeInfo.runtime, [
    'inspect',
    '--execution-requirements',
    '--include-system-env-vars',
    reports.wrapperRelative,
  ], {
    root,
    env,
    timeoutMs: Math.min(60000, remainingTime(deadline, '脚本预检')),
  });
  if (inspection.error || inspection.status !== 0) {
    throw executionFailure(
      'script-inspection-failed',
      'k6 无法加载受控入口或计算执行要求',
      inspection,
      { location: { path: configuration.script.relative } },
    );
  }
  const runArguments = [
    'run',
    '--no-usage-report',
    reports.wrapperRelative,
  ];
  const execution = await invoke(runtimeInfo.runtime, runArguments, {
    root,
    env,
    timeoutMs: remainingTime(deadline, '压测执行'),
    output,
  });
  if (execution.timedOut) {
    throw executionFailure('timeout', `k6 压测执行超过 ${timeoutMs}ms`, execution);
  }
  if (execution.error) {
    throw executionFailure('process-failed', 'k6 压测进程启动或执行失败', execution);
  }
  return Object.freeze({
    runId,
    k6Version: runtimeInfo.version,
    process: execution,
  });
}
