import path from 'node:path';
import { existsSync } from 'node:fs';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { resolveCiRange } from './change-range.js';
import { validateCiReportPath } from '../../config/validation-primitives.js';
import { classifyChanges } from '../../policies/change-classification.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { createGateResult, gateStatusToExitCode } from '../../core/result/gate-result.js';
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from '../../core/report/console-renderer.js';
import { renderCiStep, renderGateResultJson } from '../../core/report/json-renderer.js';
import {
  createChangeSet,
  createGateContext,
} from '../../core/capability/gate-context.js';
import { createProjectGateRegistry } from '../../gates/registry.js';
import { REPOSITORY_GATE_IDS } from '../../gates/project-applicability.js';
import { defineExecutionPlan, validateExecutionPlan } from '../../core/capability/execution-plan.js';
import { scopeProjectChanges } from '../workspace/targets.js';
import {
  createProjectCiFullPlan,
  createProjectReleaseReadyPlan,
  executionPlans,
} from '../execution-plans.js';
import { orchestratePlan } from '../orchestrator.js';
import { writeCiReport } from './report.js';
import { createCiGatePolicyController } from './gate-policy.js';

function isTrustedExternalGateCi(env) {
  return env.GITLAB_CI === 'true' && env.CI_COMMIT_REF_PROTECTED === 'true';
}

function configurationErrorReport(profile, error) {
  return {
    version: 1,
    status: 'configuration-error',
    profile: profile ?? null,
    base: null,
    head: null,
    steps: [],
    error: error.message,
  };
}

function writeCiLifecycleError(gateId, status, error) {
  const kind = status.slice(0, -6);
  const typedError = toRepoGuardError(error, {
    kind,
    code: `ci/${kind}-failed`,
  });
  const result = createGateResult({
    gateId,
    status,
    summary: typedError.message,
    error: typedError,
  });
  writeGateResultConsole(result, { label: gateId });
  return renderGateResultJson(result);
}

function scopedPlan(plan, scope, root, registry, { skipRepositoryAgentPolicy = false } = {}) {
  if (scope === 'all') return plan;
  const steps = plan.steps.filter(({ gateId }) => {
    if (scope === 'evidence') return gateId === 'release.delivery-evidence';
    if (gateId === 'release.delivery-evidence') return false;
    if (gateId === 'repository.agent-policy') return scope === 'project' || !skipRepositoryAgentPolicy;
    if (gateId === 'dependencies.policy') return scope === 'project' || existsSync(path.join(root, 'package.json'));
    return scope === 'repository' ? REPOSITORY_GATE_IDS.has(gateId) : !REPOSITORY_GATE_IDS.has(gateId);
  });
  return validateExecutionPlan(defineExecutionPlan({ ...plan, id: `${plan.id}:${scope}`, steps }), registry);
}

export async function runCiGate({
  root,
  repositoryRoot = root,
  config,
  base = null,
  head = null,
  profile = config.ci.profile,
  reportPath = config.ci.reportPath,
  env = process.env,
  scope = 'all',
  resolvedRange = null,
  initialPriorResults = [],
  skipRepositoryAgentPolicy = false,
  onReport = null,
} = {}) {
  reportPath ||= config.ci.reportPath;
  reportPath = validateCiReportPath(reportPath);
  if (config.externalGates.some(({ report }) => report.path.toLowerCase() === reportPath.toLowerCase())) {
    throw configurationError('ci/report-path-collision', 'CI 汇总报告路径不得与外部门禁报告路径相同。');
  }
  if (!['all', 'repository', 'project', 'evidence'].includes(scope)) {
    throw configurationError('ci/invalid-scope', 'CI 执行范围必须为整个项目、仓库、应用或交付证据。');
  }
  const publishReport = (report) => {
    const output = { ...report, ...(config.configVersion === 2 ? {
      projectId: config.project?.id ?? null,
      projectRoot: path.relative(repositoryRoot, root).replaceAll('\\', '/') || '.',
      scope,
    } : {}) };
    writeCiReport(root, reportPath, output);
    if (onReport) onReport(output);
  };
  if (!config.ci.enabled) {
    const error = configurationError(
      'ci/disabled',
      'CI 门禁已禁用。请运行 repo-guard install-ci 或 repo-guard enable ci。',
    );
    const gateResult = writeCiLifecycleError('ci.configuration', 'configuration-error', error);
    publishReport({
      ...configurationErrorReport(profile, error),
      gateResult,
    });
    return gateStatusToExitCode('configuration-error');
  }
  if (!['policy', 'full', 'release-ready'].includes(profile)) {
    const error = configurationError(
      'ci/invalid-profile',
      'CI 配置档必须为 policy、full 或 release-ready',
    );
    const gateResult = writeCiLifecycleError('ci.configuration', 'configuration-error', error);
    publishReport({
      ...configurationErrorReport(profile, error),
      gateResult,
    });
    return gateStatusToExitCode('configuration-error');
  }

  let range;
  try {
    const fullRange = resolvedRange ?? resolveCiRange(repositoryRoot, { base, head, env });
    range = root === repositoryRoot ? fullRange : {
      ...fullRange,
      changes: scopeProjectChanges(fullRange.changes, path.relative(repositoryRoot, root).replaceAll('\\', '/')),
    };
  } catch (error) {
    const report = {
      version: 1,
      status: 'range-error',
      profile,
      base: base ?? null,
      head: head ?? null,
      steps: [],
      error: error.message,
    };
    report.gateResult = writeCiLifecycleError('ci.range', 'range-error', error);
    publishReport(report);
    return gateStatusToExitCode('range-error');
  }

  const reportPaths = new Set([reportPath, ...config.externalGates.map(({ report }) => report.path)]);
  const projectFiles = collectProjectFiles(root)
    .filter((file) => !reportPaths.has(file) && !file.startsWith('reports/.npm-cache/'));
  const steps = [];
  const recordResult = (
    name,
    result,
    { includeGateResult = false, gatePolicy = null } = {},
  ) => {
    steps.push(renderCiStep(result, { name, includeGateResult, gatePolicy }));
    writeGateResultConsole(result, { label: name });
  };
  const registry = createProjectGateRegistry(config);
  const includeExternalGates = isTrustedExternalGateCi(env);
  const originalPlan = profile === 'release-ready'
    ? createProjectReleaseReadyPlan(config, registry, { includeExternalGates })
    : profile === 'full'
      ? createProjectCiFullPlan(config, registry, { includeExternalGates })
      : executionPlans.get('ci-policy');
  const ciPlan = scopedPlan(originalPlan, scope, root, registry, { skipRepositoryAgentPolicy });
  const changeSet = createChangeSet({
    source: 'ci',
    changes: range.changes,
    revision: { base: range.base, head: range.head },
  });
  const context = createGateContext({
    root,
    repositoryRoot,
    environment: ciPlan.environment,
    config,
    changes: changeSet,
    files: projectFiles,
    artifactDirectory: path.dirname(path.join(root, reportPath)),
  });
  let gatePolicy;
  try {
    gatePolicy = createCiGatePolicyController({
      config,
      registry,
      plan: ciPlan,
    });
  } catch (error) {
    const typedError = toRepoGuardError(error, {
      kind: 'configuration',
      code: 'ci-gate-policy/invalid',
    });
    const gateResult = writeCiLifecycleError(
      'ci.gate-policy',
      'configuration-error',
      typedError,
    );
    publishReport({
      ...configurationErrorReport(profile, typedError),
      base: range.base,
      head: range.head,
      gateResult,
    });
    return gateStatusToExitCode('configuration-error');
  }
  const protectedChanges = classifyChanges(changeSet.entries, config);
  const execution = await orchestratePlan({
    plan: ciPlan,
    registry,
    context,
    initialPriorResults,
    prepareStepContext: gatePolicy.prepareStepContext,
    beforeStep: gatePolicy.beforeStep,
    onResult: ({ result, step }) => recordResult(
      step.reportName ?? step.id,
      result,
      {
        includeGateResult: true,
        gatePolicy: gatePolicy.describe(step),
      },
    ),
  });
  const policyExecution = gatePolicy.evaluate(execution);

  const status = policyExecution.status === 'execution-error'
    ? 'error'
    : policyExecution.status === 'configuration-error'
      || policyExecution.status === 'range-error'
      ? 'error'
    : policyExecution.status === 'violation' ? 'failed' : 'passed';
  const report = {
    version: 1,
    status,
    profile,
    base: range.base,
    head: range.head,
    protectedFiles: protectedChanges.map((change) => ({
      status: change.status,
      oldPath: change.oldPath,
      path: change.path,
      category: change.category,
      level: change.level,
      pattern: change.pattern,
    })),
    steps,
  };
  publishReport(report);
  const statusLabel = status === 'passed' ? '已通过' : '未通过';
  writeConsoleMessage(`repo-guard CI 报告：${reportPath}（${statusLabel}）。`);
  return policyExecution.exitCode;
}
