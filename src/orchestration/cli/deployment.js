import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { configurationError, executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { runStreamingProcess, terminalProcessOutput } from '../../core/execution/streaming-process.js';
import { EXIT_CODES, processExecutionToStatus, repoGuardProcessToExitCode } from '../../core/result/exit-code.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { projectPackageManager } from '../../core/project/package-manager.js';
import { runGit } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { assertCiSubject, assertCiConfiguration } from '../ci/subject.js';
import { loadOperationsConfig } from '../../operations/config/configuration.js';
import { planOperationsPipeline } from '../../operations/pipeline/plan.js';
import { createDockerDeployment, dockerCommand } from '../../operations/deployment/docker.js';
import { executeBlueGreen } from '../../operations/deployment/engine.js';
import { prepareDeploymentNotification, notifyDeployment } from './deployment-notification.js';

const CLI = fileURLToPath(new URL('../../../bin/repo-guard.js', import.meta.url));

function artifactDigest(root, paths) {
  const digest = createHash('sha256');
  let count = 0;
  function visit(relative) {
    const full = path.resolve(root, relative);
    const actual = path.relative(realpathSync(root), realpathSync(full));
    if (actual.startsWith('..') || path.isAbsolute(actual) || lstatSync(full).isSymbolicLink()) {
      throw configurationError('operations/artifact-path', '构建产物必须位于应用内且不能使用符号链接。');
    }
    if (lstatSync(full).isDirectory()) {
      for (const item of readdirSync(full).sort()) visit(`${relative}/${item}`);
    } else if (lstatSync(full).isFile()) {
      const content = readFileSync(full);
      if (!content.length) throw executionError('operations/empty-artifact', '构建产物包含空文件。');
      count += 1;
      digest.update(relative).update('\0').update(content).update('\0');
    } else throw configurationError('operations/artifact-type', '构建产物必须是普通文件或目录。');
  }
  for (const relative of paths) visit(relative);
  if (!count) throw executionError('operations/missing-artifact', '构建产物不存在或为空。');
  return digest.digest('hex');
}

export async function runDeployment(operation, cwd, { projectId, environmentId } = {}) {
  const root = findRepositoryRoot(cwd);
  const config = operation === 'status' ? null : prepareDeploymentNotification(root);
  let reported = false;
  const onEvent = async (event) => {
    if (event.status !== 'starting') reported = true;
    if (config) await notifyDeployment(config, { projectId, environmentId }, event);
  };
  try {
    const code = await performDeployment(operation, cwd, { projectId, environmentId, onEvent });
    if (code !== EXIT_CODES.success && !reported) await onEvent({ operation, status: 'failed' });
    return code;
  } catch (error) {
    if (!reported) await onEvent({ operation, status: 'failed', error });
    throw toRepoGuardError(error, { code: 'operations/deployment-error' });
  }
}

async function performDeployment(operation, cwd, { projectId, environmentId, onEvent }) {
  if (!projectId || !environmentId) {
    throw configurationError('operations/deployment-selection', '请显式提供 --project 与 --environment。');
  }
  const root = findRepositoryRoot(cwd);
  const workspace = loadWorkspace(root);
  const operations = loadOperationsConfig(root);
  const project = workspace.projects.find((item) => item.id === projectId);
  const unit = operations.projects[projectId];
  const environment = unit?.environments[environmentId];
  if (!operations.enabled || !unit?.enabled || !project || !environment?.blueGreen) {
    throw configurationError('operations/deployment-selection', '请显式选择已启用蓝绿部署的 --project 与 --environment。');
  }
  const adapter = createDockerDeployment(environment.blueGreen);
  if (operation !== 'deploy') {
    const result = await executeBlueGreen(adapter, operation, null, { onEvent });
    writeConsoleMessage(`部署状态：${JSON.stringify(result, null, 2)}`);
    return EXIT_CODES.success;
  }
  if (!workspace.repositoryConfig.ci.enabled) {
    throw configurationError('operations/quality-required', '发布要求启用阻断型质量 CI；只报告或关闭检查不能作为发布通过证据。');
  }
  planOperationsPipeline(root, operations, workspace.projects.map((item) => ({
    id: item.id, root: item.relativeRoot, stack: item.project.stack,
  })));
  const revision = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  const branch = process.env.CI_COMMIT_BRANCH || runGit(['branch', '--show-current'], { cwd: root }).stdout.trim();
  if (!environment.branches.includes(branch)) throw configurationError('operations/branch-denied', '当前分支不在该环境允许发布的分支清单中。');
  assertCiConfiguration(root, [path.join(root, 'repo-guard.ops.json')]);
  assertCiSubject(root, revision);
  writeConsoleMessage('发布前执行项目已配置的质量检查。');
  const reportFile = `reports/operations-${projectId}-${randomUUID()}.json`;
  const quality = await runStreamingProcess({ command: process.execPath,
    argumentsList: [CLI, unit.verifyDelivery ? 'delivery-check' : 'ci', '--project', projectId, '--head', revision, '--report-json', reportFile],
    root, timeoutMs: 3600000, output: terminalProcessOutput(true) });
  const qualityCode = repoGuardProcessToExitCode(quality);
  if (qualityCode !== EXIT_CODES.success) return qualityCode;
  // 检查报告必须给出本次通过结果，不能用报告模式的零码或跳过作为部署证据。
  const reportPath = path.resolve(root, reportFile);
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch {
    throw executionError('operations/quality-report', '无法读取本次质量报告，拒绝发布。');
  }
  if (report.version !== 2 || report.status !== 'passed' || report.head !== revision) {
    throw executionError('operations/quality-not-passed', '本次质量报告未明确通过，拒绝发布。');
  }
  const projectRoot = path.resolve(root, project.relativeRoot);
  const command = unit.build?.command ?? projectPackageManager(projectRoot);
  const args = unit.build?.args ?? ['run', unit.buildScript];
  writeConsoleMessage('质量检查通过，开始构建本次发布产物。');
  const build = await runStreamingProcess({ command, argumentsList: args, root: projectRoot,
    env: { ...process.env, REPO_GUARD_REVISION: revision }, timeoutMs: 3600000, output: terminalProcessOutput(true) });
  if (processExecutionToStatus(build) !== 'passed') throw executionError('operations/build-failed', '发布构建失败、超时或被信号终止。');
  const artifacts = artifactDigest(projectRoot, unit.artifactPaths);
  assertCiSubject(root, revision);
  const tag = `${environment.blueGreen.name}:${revision}-${randomUUID().slice(0, 8)}`;
  dockerCommand(['build', '-f', environment.blueGreen.dockerfile, '--label', `com.repo-guard.revision=${revision}`, '-t', tag, '.'], { cwd: projectRoot, timeout: 1800000 });
  const image = JSON.parse(dockerCommand(['image', 'inspect', tag]))[0].Id;
  if (artifactDigest(projectRoot, unit.artifactPaths) !== artifacts) {
    throw executionError('operations/artifact-changed', '镜像构建期间产物发生变化，拒绝部署。');
  }
  assertCiSubject(root, revision);
  writeConsoleMessage(environment.blueGreen.backup.enabled
    ? '产物已绑定源码版本，开始备份、蓝绿切换与健康检查。'
    : '产物已绑定源码版本，开始蓝绿切换与健康检查；本次不备份或恢复数据。');
  const result = await executeBlueGreen(adapter, 'deploy', { revision, image, artifacts,
    operationsDigest: createHash('sha256').update(JSON.stringify(operations)).digest('hex') }, { onEvent });
  writeConsoleMessage(`部署完成：${projectId}/${environmentId}，活动环境 ${result.active.color}，版本 ${revision}。`);
  return EXIT_CODES.success;
}
