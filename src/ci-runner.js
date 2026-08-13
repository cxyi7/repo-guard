import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { resolveCiRange } from './ci-changes.js';
import { validateCiReportPath } from './config.js';
import { classifyChanges } from './git-changes.js';
import { runGit } from './git.js';
import { collectProjectFiles } from './file-placement.js';
import { gateStatusToExitCode } from './core/result/gate-result.js';
import { writeGateResultConsole } from './core/report/console-renderer.js';
import { renderCiStep } from './core/report/json-renderer.js';
import {
  createChangeSet,
  createGateContext,
} from './core/capability/gate-context.js';
import { gateRegistry } from './gates/registry.js';
import { executionPlans } from './orchestration/execution-plans.js';
import { orchestratePlan } from './orchestration/orchestrator.js';

function matchingFiles(files, pattern) {
  return files.filter((file) => micromatch.isMatch(file, pattern, {
    dot: true,
    matchBase: true,
  }));
}

function assertNoSymlinkPath(root, reportPath) {
  let current = root;
  for (const segment of reportPath.split('/')) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`CI report path must not traverse a symbolic link: ${reportPath}`);
    }
  }
}

export function writeCiReport(root, reportPath, report) {
  const normalized = validateCiReportPath(reportPath);
  assertNoSymlinkPath(root, normalized);
  const tracked = runGit(['ls-files', '--error-unmatch', '--', normalized], {
    allowFailure: true,
    cwd: root,
  }).status === 0;
  if (tracked) throw new Error(`CI report path must not overwrite a tracked file: ${normalized}`);
  const target = path.resolve(root, normalized);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
    const error = new Error(
      'CI gate is disabled. Run repo-guard install-ci or repo-guard enable ci.',
    );
    writeCiReport(root, reportPath, configurationErrorReport(profile, error));
    console.error(`repo-guard CI configuration failed: ${error.message}`);
    return gateStatusToExitCode('configuration-error');
  }
  if (!['policy', 'full'].includes(profile)) {
    const error = new Error('CI profile must be policy or full');
    writeCiReport(root, reportPath, configurationErrorReport(profile, error));
    console.error(`repo-guard CI configuration failed: ${error.message}`);
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
    writeCiReport(root, reportPath, report);
    console.error(`repo-guard CI range failed: ${error.message}`);
    return gateStatusToExitCode('range-error');
  }

  const projectFiles = collectProjectFiles(root)
    .filter((file) => file !== reportPath && !file.startsWith(`${reportPath}/`));
  const steps = [];
  const recordResult = (name, result, {
    includeGateResult = false,
    includeDiagnostics = true,
  } = {}) => {
    steps.push(renderCiStep(result, { name, includeGateResult }));
    writeGateResultConsole(
      includeDiagnostics ? result : { ...result, diagnostics: [] },
      { label: name },
    );
  };
  const ciPlan = executionPlans.get(profile === 'full' ? 'ci-full' : 'ci-policy');
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
    registry: gateRegistry,
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
        const gate = gateRegistry.get(step.gateId);
        const gatePlan = await gate.plan(stepContext);
        const result = await gate.run({ ...stepContext, plan: gatePlan });
        for (const line of gate.renderConsole(result)) {
          if (line.stream === 'stderr') console.error(line.message);
          else console.log(line.message);
        }
        return { name: 'dynamic-code', result, recordOptions: { includeGateResult: true, includeDiagnostics: false } };
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
        const gate = gateRegistry.get(step.gateId);
        const gatePlan = await gate.plan(stepContext);
        const result = await gate.run({ ...stepContext, plan: gatePlan });
        for (const line of gate.renderConsole?.(result) ?? []) {
          if (line.stream === 'stderr') console.error(line.message);
          else console.log(line.message);
        }
        return { name: step.id, result, recordOptions: { includeGateResult: true, includeDiagnostics: false } };
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
  console.log(`repo-guard CI report: ${reportPath} (${status}).`);
  return execution.exitCode;
}
