import path from 'node:path';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult, gateStatusToExitCode } from '../../core/result/gate-result.js';
import { aggregateExitCodes, aggregateGateResults } from '../../core/result/exit-code.js';
import { renderGateResultJson } from '../../core/report/json-renderer.js';
import { calculateGateResultDigest } from '../../policies/delivery-contract/digests.js';
import { composeAgentPolicyConfig, selectProjects, projectAffected, scopeRepositoryProtectionChanges, projectConfigurationChanged } from '../workspace/targets.js';
import { resolveCiRange } from './change-range.js';
import { runCiGate } from './runner.js';
import { assertCiReportVersion, CI_REPORT_VERSION, writeCiReport } from './report.js';

/** 同一门禁跨应用时按最严重结果汇总，避免后执行的成功覆盖先前失败。 */
export function aggregateWorkspaceGateResults(targets) {
  const latestByTarget = new Map();
  for (const target of targets) {
    assertCiReportVersion(target.report);
    const results = (target.report.steps ?? []).map(({ gateResult }) => gateResult).filter(Boolean);
    if (target.report.gateResult) results.push(target.report.gateResult);
    for (const result of results) {
      const key = `${target.projectId ?? '@repository'}:${result.gateId}`;
      const previous = latestByTarget.get(key);
      const selected = aggregateGateResults(previous ? [result, previous.result] : [result]).decisiveResult;
      latestByTarget.set(key, { projectId: target.projectId, result: selected });
    }
  }
  const groups = new Map();
  for (const entry of latestByTarget.values()) {
    const list = groups.get(entry.result.gateId) ?? [];
    groups.set(entry.result.gateId, [...list, entry]);
  }
  return [...groups.entries()].map(([gateId, entries]) => {
    if (entries.length === 1) return entries[0].result;
    const decisive = aggregateGateResults(entries.map(({ result }) => result)).decisiveResult;
    return renderGateResultJson(createGateResult({
      gateId,
      status: decisive.status,
      summary: `${gateId} 已汇总 ${entries.length} 个目标的本轮工程检查结果。`,
      error: decisive.error ?? null,
      metrics: { targets: entries.length },
      diagnostics: entries.map(({ projectId, result }) => ({
        level: 'info',
        message: `目标 ${projectId ?? '仓库'}，检查状态 ${result.status}，结果指纹 ${calculateGateResultDigest(result)}。`,
      })),
    }));
  });
}

function failedTargetReport(error, profile, range, target) {
  const typed = toRepoGuardError(error, { kind: 'execution', code: 'ci/target-failed' });
  const status = errorStatus(typed);
  const result = createGateResult({ gateId: 'ci.execution', status, summary: typed.message, error: typed });
  return {
    version: CI_REPORT_VERSION, status: 'error', profile, base: range.base, head: range.head,
    projectId: target.projectId, projectRoot: target.projectRoot, scope: target.scope,
    steps: [], error: typed.message, gateResult: renderGateResultJson(result),
  };
}

/** 仓库门禁执行一次；应用使用各自目录、配置与报告，最后复核交付证据。 */
export async function runWorkspaceCi({ workspace, options = {} }) {
  const profile = options.profile ?? workspace.repositoryConfig.ci.profile;
  const reportPath = options.reportPath ?? workspace.repositoryConfig.ci.reportPath;
  const range = options.resolvedRange ?? resolveCiRange(workspace.root, options);
  const projects = selectProjects(workspace, options.projectId).filter((project) =>
    options.projectId !== undefined || profile === 'release-ready' || projectAffected(workspace, project, range.changes));
  const hasRootProject = projects.some((application) => application.root === workspace.root);
  const rootApplication = workspace.projects.find((application) => application.root === workspace.root);
  // 规范归属由应用清单决定；没有应用变更时，仍须核验同一份合成后的根规范。
  const rootAgentPolicyConfig = rootApplication
    ? composeAgentPolicyConfig(rootApplication.config, workspace.repositoryConfig) : null;
  const repositoryTarget = {
    projectId: null, projectRoot: '.', root: workspace.root,
    config: workspace.repositoryConfig, scope: 'repository',
    reportPath: 'reports/repo-guard-workspace/repository.json',
  };
  const targets = [repositoryTarget, ...projects.map((application) => ({
    projectId: application.id, projectRoot: application.relativeRoot, root: application.root,
    config: application.config, scope: 'project',
    configurationChanged: projectConfigurationChanged(workspace, application, range.changes),
    reportPath: `reports/repo-guard-workspace/projects/${application.id}.json`,
  }))];
  if (profile === 'release-ready') targets.push({
    ...repositoryTarget, scope: 'evidence', reportPath: 'reports/repo-guard-workspace/evidence.json',
  });
  const aggregatePath = path.resolve(workspace.root, reportPath).toLowerCase();
  if (targets.some((target) => path.resolve(target.root, target.reportPath).toLowerCase() === aggregatePath)) {
    throw configurationError('ci/report-path-collision', '聚合报告路径不得与仓库、应用或交付证据报告路径相同。');
  }
  const externalReports = new Set([workspace.repositoryConfig, ...projects.map(({ config }) => config)]
    .flatMap((config, index) => config.ci.externalGates.map(({ report }) => (
      path.resolve(index === 0 ? workspace.root : projects[index - 1].root, report.path).toLowerCase()
    ))));
  const generatedReports = [aggregatePath, ...targets.map((target) => path.resolve(target.root, target.reportPath).toLowerCase())];
  if (generatedReports.some((file) => externalReports.has(file))) {
    throw configurationError('ci/report-path-collision', '聚合报告、目标报告和外部门禁报告必须使用不同路径。');
  }
  const completed = [];
  for (const target of targets) {
    let report;
    let exitCode;
    try {
      exitCode = await runCiGate({
        ...options,
        root: target.root,
        repositoryRoot: workspace.root,
        config: target.config,
        configurationChanged: target.configurationChanged ?? false,
        scope: target.scope,
        skipRepositoryAgentPolicy: target.scope === 'repository' && hasRootProject,
        agentPolicyConfig: target.root === workspace.root ? rootAgentPolicyConfig : null,
        reportPath: target.reportPath,
        profile,
        resolvedRange: range,
        repositoryProtectedChanges: target.scope === 'repository' ? scopeRepositoryProtectionChanges(workspace, range.changes) : null,
        initialPriorResults: target.scope === 'evidence' ? aggregateWorkspaceGateResults(completed) : [],
        onReport: (value) => { report = value; },
      });
    } catch (error) {
      report = failedTargetReport(error, profile, range, target);
      exitCode = gateStatusToExitCode(report.gateResult.status);
      writeCiReport(target.root, target.reportPath, report);
    }
    completed.push({
      projectId: target.projectId, projectRoot: target.projectRoot, scope: target.scope,
      reportPath: path.relative(workspace.root, path.resolve(target.root, target.reportPath)).replaceAll('\\', '/'),
      exitCode, report,
    });
  }
  const exitCode = aggregateExitCodes(completed.map((target) => target.exitCode));
  const report = {
    version: CI_REPORT_VERSION,
    status: exitCode === 0 ? 'passed' : 'failed',
    profile, base: range.base, head: range.head,
    selectedProjects: projects.map(({ id }) => id),
    targets: completed,
    gateResults: aggregateWorkspaceGateResults(completed),
    scopedGateResults: completed.flatMap((target) => (target.report.steps ?? [])
      .filter((step) => step.gateResult)
      .map((step) => ({ projectId: target.projectId, projectRoot: target.projectRoot, gateResult: step.gateResult }))),
  };
  writeCiReport(workspace.root, reportPath, report);
  return exitCode;
}
