import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import micromatch from 'micromatch';
import { resolveCiRange } from './change-range.js';
import { validateCiReportPath } from '../../config.js';
import { classifyChanges } from '../../git-changes.js';
import { collectProjectFiles } from '../../file-placement.js';
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

function matchingFiles(files, pattern) {
  return files.filter((file) => micromatch.isMatch(file, pattern, {
    dot: true,
    matchBase: true,
  }));
}

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
      'CI gate is disabled. Run repo-guard install-ci or repo-guard enable ci.',
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
      'CI profile must be policy, full, or release-ready',
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
  const recordResult = (name, result, { includeGateResult = false } = {}) => {
    steps.push(renderCiStep(result, { name, includeGateResult }));
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
  const protectedChanges = classifyChanges(changeSet.entries, config);
  const execution = await orchestratePlan({
    plan: ciPlan,
    registry,
    context,
    executeStep: async ({ context: stepContext, gate, step }) => {
      switch (step.id) {
      case 'repository.structured-exceptions':
      case 'security.vue-unsafe-html':
      case 'security.vue-target-blank':
      case 'accessibility.vue-form-label':
      case 'accessibility.vue-image-alt':
      case 'dependencies.policy':
      case 'repository.file-placement':
      case 'repository.maximum-file-lines': {
        const gatePlan = await gate.plan(stepContext);
        return { name: step.id, result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
      }
      case 'security.dynamic-code': {
        const gate = registry.get(step.gateId);
        const gatePlan = await gate.plan(stepContext);
        const result = await gate.run({ ...stepContext, plan: gatePlan });
        return { name: 'dynamic-code', result, recordOptions: { includeGateResult: true } };
      }
      case 'quality.unit-test-policy':
        {
          const gatePlan = await gate.plan(stepContext);
          return { name: 'unit-test-policy', result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
        }
      case 'repository.protected-files':
        {
          const gatePlan = await gate.plan(stepContext);
          return { name: 'protected-files', result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
        }
      case 'quality.stylelint-project':
        {
          const selected = matchingFiles(projectFiles, config.preCommit.stylelint.pattern);
          const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: selected }));
          return { name: 'stylelint', result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
        }
      case 'quality.eslint-project':
      case 'quality.prettier-project': {
        const selected = step.id === 'quality.eslint-project'
          ? matchingFiles(projectFiles, config.preCommit.eslint.pattern)
          : matchingFiles(projectFiles, config.preCommit.prettier.pattern);
        const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: selected }));
        return { name: step.id === 'quality.eslint-project' ? 'eslint' : 'prettier', result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
      }
      case 'quality.typecheck':
      case 'quality.build': {
        const gatePlan = await gate.plan(stepContext);
        return { name: step.id === 'quality.typecheck' ? 'type-check' : 'build', result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
      }
      case 'quality.unit-test':
      case 'quality.accessibility-test':
      case 'quality.architecture':
        {
          const gatePlan = await gate.plan(stepContext);
          return { name: step.id, result: await gate.run({ ...stepContext, plan: gatePlan }), recordOptions: { includeGateResult: true } };
        }
      default: {
        const gate = registry.get(step.gateId);
        const gatePlan = await gate.plan(stepContext);
        const result = await gate.run({ ...stepContext, plan: gatePlan });
        return { name: step.id, result, recordOptions: { includeGateResult: true } };
      }
      }
    },
    onResult: ({ outcome, result, step }) => {
      if (outcome.recorded) return;
      recordResult(outcome.name ?? step.id, result, outcome.recordOptions);
    },
  });

  const status = execution.status === 'execution-error'
    ? 'error'
    : execution.status === 'configuration-error' || execution.status === 'range-error'
      ? 'error'
    : execution.status === 'violation' ? 'failed' : 'passed';
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
  writeConsoleMessage(`repo-guard CI report: ${reportPath} (${status}).`);
  return execution.exitCode;
}
