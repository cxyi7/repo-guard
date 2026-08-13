import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { runAccessibilityTestGate } from './accessibility-test-runner.js';
import { runArchitectureGate } from './architecture-runner.js';
import { runBuildGate } from './build-runner.js';
import { resolveCiRange } from './ci-changes.js';
import { validateCiReportPath } from './config.js';
import { classifyChanges } from './git-changes.js';
import { runGit } from './git.js';
import { runDependencyPolicy } from './dependency-policy.js';
import { runEslintFiles } from './eslint-runner.js';
import { inspectExceptionRegistry } from './exception-registry.js';
import { collectProjectFiles, runFilePlacementProject } from './file-placement.js';
import { runMaxFileLinesFiles, selectMaxFileLineFiles } from './max-file-lines.js';
import { runPrettierFiles } from './prettier-runner.js';
import { runStylelintFiles } from './stylelint-runner.js';
import { runTypeCheckGate } from './typecheck-runner.js';
import {
  buildUnitTestAiInstructions,
  inspectUnitTestPolicy,
  runUnitTestGate,
} from './unit-test-runner.js';
import { runUnsafeVueHtmlProject } from './vue-unsafe-html.js';
import { runVueFormLabelProject } from './vue-form-label.js';
import { runVueImageAltProject } from './vue-image-alt.js';
import { runVueTargetBlankProject } from './vue-target-blank.js';
import { createGateResult, gateStatusToExitCode } from './core/result/gate-result.js';
import { adaptNumericRunner } from './core/result/numeric-runner-adapter.js';
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
  const runStep = async (gateId, name, task, { enabled = true } = {}) => {
    if (!enabled) {
      const result = createGateResult({
        gateId,
        status: 'skipped',
        summary: `${name} is disabled`,
      });
      recordResult(name, result);
      return { name, result, recorded: true };
    }
    const result = await adaptNumericRunner({ gateId, task });
    return { name, result };
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
        return await runStep(gate.id, 'structured-exceptions', () => { const result = inspectExceptionRegistry(config.exceptions); return result.expired.length || result.future.length ? 2 : 0; });
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
      case 'security.vue-unsafe-html':
        return await runStep(gate.id, 'vue-unsafe-html', () => runUnsafeVueHtmlProject({ root, exceptions: config.exceptions }));
      case 'security.vue-target-blank':
        return await runStep(gate.id, 'vue-target-blank', () => runVueTargetBlankProject({ root, exceptions: config.exceptions }));
      case 'accessibility.vue-form-label':
        return await runStep(gate.id, 'vue-form-labels', () => runVueFormLabelProject({ root, exceptions: config.exceptions }));
      case 'accessibility.vue-image-alt':
        return await runStep(gate.id, 'vue-image-alt', () => runVueImageAltProject({ root, exceptions: config.exceptions }));
      case 'dependencies.policy':
        return await runStep(gate.id, 'dependency-policy', () => runDependencyPolicy({ root, config: config.dependencyPolicy, exceptions: config.exceptions }), { enabled: config.dependencyPolicy.enabled });
      case 'repository.file-placement':
        return await runStep(gate.id, 'file-placement', () => runFilePlacementProject({ root, config: config.preCommit.filePlacement }), { enabled: config.preCommit.filePlacement.enabled });
      case 'repository.maximum-file-lines':
        return await runStep(gate.id, 'maximum-file-lines', () => runMaxFileLinesFiles({
          root,
          files: selectMaxFileLineFiles(
            projectFiles.map((relative) => ({
              relative,
              absolute: path.join(root, relative),
            })),
            config.preCommit.maxFileLines,
          ),
          config: config.preCommit.maxFileLines,
          baselineRef: range.base,
          changes: changeSet.entries,
        }), { enabled: config.preCommit.maxFileLines.enabled });
      case 'quality.unit-test-policy':
        return await runStep(gate.id, 'unit-test-policy', () => { const policy = inspectUnitTestPolicy({ root, changes: changeSet, config: config.unitTest }); if (policy.missingTests.length || policy.bypasses.length || policy.componentInteractions.length) { console.error(buildUnitTestAiInstructions({ ...policy, script: config.unitTest.script })); return 2; } return 0; }, { enabled: config.unitTest.enabled && profile === 'policy' });
      case 'repository.protected-files':
        return await runStep(gate.id, 'protected-files', () => { if (protectedChanges.length === 0) return 0; for (const change of protectedChanges) console.log(`Protected ${change.level}: ${change.path} (${change.category})`); return config.ci.protectedFiles.action === 'fail' ? 2 : 0; });
      case 'quality.stylelint-project':
        return await runStep(gate.id, 'stylelint', () => runStylelintFiles({ root, files: matchingFiles(projectFiles, config.preCommit.stylelint.pattern), fix: false, maxWarnings: config.preCommit.stylelint.maxWarnings, requireConfig: config.preCommit.stylelint.requireConfig, complexity: config.preCommit.stylelint.complexity, governance: config.preCommit.stylelint.governance, exceptions: config.exceptions }), { enabled: config.preCommit.stylelint.enabled });
      case 'quality.eslint-project':
        return await runStep(gate.id, 'eslint', () => runEslintFiles({ root, files: matchingFiles(projectFiles, config.preCommit.eslint.pattern), fix: false, maxWarnings: config.preCommit.eslint.maxWarnings, preset: config.preCommit.eslint.preset }), { enabled: config.preCommit.eslint.enabled });
      case 'quality.prettier-project':
        return await runStep(gate.id, 'prettier', () => runPrettierFiles({ root, files: matchingFiles(projectFiles, config.preCommit.prettier.pattern), fix: false, requireConfig: config.preCommit.prettier.requireConfig }), { enabled: config.preCommit.prettier.enabled });
      case 'quality.typecheck':
        return await runStep(gate.id, 'type-check', () => runTypeCheckGate({ root, config: config.typeCheck }), { enabled: config.typeCheck.enabled });
      case 'quality.unit-test':
        return await runStep(gate.id, 'unit-tests', () => runUnitTestGate({ root, config: config.unitTest, changes: changeSet }), { enabled: config.unitTest.enabled });
      case 'quality.accessibility-test':
        return await runStep(gate.id, 'accessibility-tests', () => runAccessibilityTestGate({ root, config: config.accessibilityTest }), { enabled: config.accessibilityTest.enabled });
      case 'quality.architecture':
        return await runStep(gate.id, 'architecture', () => runArchitectureGate({ root, config: config.architecture }), { enabled: config.architecture.enabled });
      case 'quality.build':
        return await runStep(gate.id, 'build', () => runBuildGate({ root, config: config.build }), { enabled: config.build.enabled });
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
