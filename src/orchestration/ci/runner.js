import path from 'node:path';
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

export async function runCiGate({
  root,
  config,
  base = null,
  head = null,
  profile = config.ci.profile,
  reportPath = config.ci.reportPath,
  env = process.env,
} = {}) {
  reportPath ||= config.ci.reportPath;
  reportPath = validateCiReportPath(reportPath);
  if (!config.ci.enabled) {
    const error = configurationError(
      'ci/disabled',
      'CI 门禁已禁用。请运行 repo-guard install-ci 或 repo-guard enable ci。',
    );
    const gateResult = writeCiLifecycleError('ci.configuration', 'configuration-error', error);
    writeCiReport(root, reportPath, {
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
    writeCiReport(root, reportPath, {
      ...configurationErrorReport(profile, error),
      gateResult,
    });
    return gateStatusToExitCode('configuration-error');
  }

  let range;
  try {
    range = resolveCiRange(root, { base, head, env });
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
    writeCiReport(root, reportPath, report);
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
  const ciPlan = profile === 'release-ready'
    ? createProjectReleaseReadyPlan(config, registry, { includeExternalGates })
    : profile === 'full'
      ? createProjectCiFullPlan(config, registry, { includeExternalGates })
      : executionPlans.get('ci-policy');
  const changeSet = createChangeSet({
    source: 'ci',
    changes: range.changes,
    revision: { base: range.base, head: range.head },
  });
  const context = createGateContext({
    root,
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
    writeCiReport(root, reportPath, {
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
  writeCiReport(root, reportPath, report);
  const statusLabel = status === 'passed' ? '已通过' : '未通过';
  writeConsoleMessage(`repo-guard CI 报告：${reportPath}（${statusLabel}）。`);
  return policyExecution.exitCode;
}
