import path from 'node:path';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { resolveCiRange } from './change-range.js';
import { validateCiReportPath } from '../../config/validation-primitives.js';
import { classifyChanges } from '../../policies/change-classification.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { createGateResult, gateResultToExitCode } from '../../core/result/gate-result.js';
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
import { REPOSITORY_GATE_IDS, SHARED_AND_APPLICATION_GATE_IDS } from '../../gates/project-applicability.js';
import { defineExecutionPlan, validateExecutionPlan } from '../../core/capability/execution-plan.js';
import { scopeProjectChanges } from '../workspace/targets.js';
import {
  createProjectCiFullPlan,
  createProjectReleaseReadyPlan,
  executionPlans,
} from '../execution-plans.js';
import { orchestratePlan } from '../orchestrator.js';
import { CI_REPORT_VERSION, writeCiReport } from './report.js';
import { createCiGatePolicyController } from './gate-policy.js';
import { deliveryDigest, deliveryTestDigest, hasDeliveryBinding, loadDeliveryWorkspace } from '../../policies/delivery-contract/collaboration.js';
import { assertCleanSubject, recordDeliveryGateResults } from '../delivery/execution.js';

function isTrustedExternalGateCi(env) {
  return env.GITLAB_CI === 'true' && env.CI_COMMIT_REF_PROTECTED === 'true';
}

function configurationErrorReport(profile, error) {
  return {
    version: CI_REPORT_VERSION,
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
    status: errorStatus(typedError),
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
    if (SHARED_AND_APPLICATION_GATE_IDS.has(gateId)) return true;
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
  agentPolicyConfig = null,
  onReport = null,
  repositoryProtectedChanges = null,
  configurationChanged = null,
} = {}) {
  reportPath ||= config.ci.reportPath;
  reportPath = validateCiReportPath(reportPath);
  if (config.ci.externalGates.some(({ report }) => report.path.toLowerCase() === reportPath.toLowerCase())) {
    throw configurationError('ci/report-path-collision', 'CI 汇总报告路径不得与外部门禁报告路径相同。');
  }
  if (!['all', 'repository', 'project', 'evidence'].includes(scope)) {
    throw configurationError('ci/invalid-scope', 'CI 执行范围必须为整个项目、仓库、应用或交付证据。');
  }
  const publishReport = (report) => {
    const output = { ...report,
      projectId: config.project?.id ?? null,
      projectRoot: path.relative(repositoryRoot, root).replaceAll('\\', '/') || '.',
      scope,
    };
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
    return gateResultToExitCode(gateResult);
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
    return gateResultToExitCode(gateResult);
  }

  let range;
  try {
    const fullRange = resolvedRange ?? resolveCiRange(repositoryRoot, { base, head, env });
    range = root === repositoryRoot ? fullRange : {
      ...fullRange,
      changes: scopeProjectChanges(fullRange.changes, path.relative(repositoryRoot, root).replaceAll('\\', '/')),
    };
  } catch (error) {
    const gateResult = writeCiLifecycleError('ci.range', 'range-error', error);
    const report = {
      version: CI_REPORT_VERSION,
      status: gateResult.status,
      profile,
      base: base ?? null,
      head: head ?? null,
      steps: [],
      error: error.message,
      gateResult,
    };
    publishReport(report);
    return gateResultToExitCode(gateResult);
  }

  const reportPaths = new Set([reportPath, ...config.ci.externalGates.map(({ report }) => report.path)]);
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
  const delivery = hasDeliveryBinding(repositoryRoot) ? loadDeliveryWorkspace(repositoryRoot) : null;
  if (delivery?.binding.enabled) config = { ...config, ci: { ...config.ci, gatePolicy: {
    ...config.ci.gatePolicy, gates: { ...config.ci.gatePolicy.gates,
      'repository.delivery-contract': { mode: 'enforce', scope: 'all-files' },
      'release.delivery-evidence': { mode: 'enforce', scope: 'all-files' },
    },
  } } };
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
    configurationChanged: configurationChanged ?? range.changes.some(({ path: current, oldPath }) => (
      current === 'repo-guard.config.json' || oldPath === 'repo-guard.config.json'
    )),
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
      status: gateResult.status,
      base: range.base,
      head: range.head,
      gateResult,
    });
    return gateResultToExitCode(gateResult);
  }
  const protectionChangeSet = repositoryProtectedChanges == null ? changeSet
    : createChangeSet({ source: changeSet.source, revision: changeSet.revision, changes: repositoryProtectedChanges });
  const protectedChanges = classifyChanges(protectionChangeSet.entries, config);
  const deliveryTargets = delivery?.binding.enabled && ['all', 'project'].includes(scope)
    ? delivery.localParticipants.filter((participant) => path.resolve(repositoryRoot, participant.root) === path.resolve(root)
      && participant.checks.some((check) => check.kind === 'gate' && ciPlan.steps.some(({ gateId }) => gateId === check.gateId)))
      .map((participant) => loadDeliveryWorkspace(repositoryRoot, { participantId: participant.id }))
    : [];
  for (const workspace of deliveryTargets) assertCleanSubject(workspace, range.head);
  const execution = await orchestratePlan({
    plan: ciPlan,
    registry,
    context,
    initialPriorResults,
    prepareStepContext: (options) => {
      if (options.gate.id === 'repository.protected-files') {
        return gatePolicy.prepareStepContext({ ...options, context: { ...options.context, changes: protectionChangeSet } });
      }
      if (options.gate.id === 'repository.agent-policy' && agentPolicyConfig) {
        return gatePolicy.prepareStepContext({
          ...options,
          context: { ...options.context, config: agentPolicyConfig },
        });
      }
      return gatePolicy.prepareStepContext(options);
    },
    beforeStep: gatePolicy.beforeStep,
    onResult: ({ result, step }) => {
      recordResult(step.reportName ?? step.id, result, {
        includeGateResult: true,
        gatePolicy: gatePolicy.describe(step),
      });
      // 同一门禁可能先检查策略、再执行工具；只记录最后一次实际执行结果。
      if (ciPlan.steps.findLast(({ gateId }) => gateId === result.gateId)?.id !== step.id) return;
      for (const workspace of deliveryTargets) {
        const checks = workspace.participant.checks.filter((check) => check.kind === 'gate' && check.gateId === result.gateId)
          .map((check) => ({ id: check.id, definitionDigest: deliveryDigest(check),
            testDigest: deliveryTestDigest(workspace, check), status: result.status === 'passed' ? 'passed' : 'failed', resultDigest: deliveryDigest(result) }));
        if (checks.length) {
          assertCleanSubject(workspace, range.head);
          recordDeliveryGateResults(workspace, checks, { preservePassed: profile === 'release-ready' });
        }
      }
    },
  });
  const policyExecution = gatePolicy.evaluate(execution);
  for (const workspace of deliveryTargets) assertCleanSubject(workspace, range.head);
  const status = policyExecution.status === 'execution-error'
    ? 'error'
    : policyExecution.status === 'configuration-error'
      || policyExecution.status === 'range-error'
      ? 'error'
    : policyExecution.status === 'violation' ? 'failed' : 'passed';
  const report = {
    version: CI_REPORT_VERSION,
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
