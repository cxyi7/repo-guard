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
import { createGateResult } from './core/result/gate-result.js';
import { adaptLegacyRunner } from './core/result/legacy-runner-adapter.js';
import { writeGateResultConsole } from './core/report/console-renderer.js';
import { renderLegacyCiStep } from './core/report/json-renderer.js';
import { gateRegistry } from './gates/registry.js';

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
    return 1;
  }
  if (!['policy', 'full'].includes(profile)) {
    const error = new Error('CI profile must be policy or full');
    writeCiReport(root, reportPath, configurationErrorReport(profile, error));
    console.error(`repo-guard CI configuration failed: ${error.message}`);
    return 1;
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
    return 3;
  }

  const projectFiles = collectProjectFiles(root)
    .filter((file) => file !== reportPath && !file.startsWith(`${reportPath}/`));
  const steps = [];
  let executionError = false;
  let violation = false;
  const recordResult = (name, result, {
    includeGateResult = false,
    exitCode = result.legacyExitCode,
    includeDiagnostics = true,
  } = {}) => {
    steps.push(renderLegacyCiStep(result, { name, includeGateResult, exitCode }));
    writeGateResultConsole(
      includeDiagnostics ? result : { ...result, diagnostics: [] },
      { label: name },
    );
    if (result.status === 'violation') {
      violation = true;
    } else if (result.status.endsWith('-error')) {
      executionError = true;
    }
  };
  const runStep = async (name, task, { enabled = true } = {}) => {
    if (!enabled) {
      const result = createGateResult({
        gateId: name,
        status: 'skipped',
        summary: `${name} is disabled`,
      });
      recordResult(name, result);
      return;
    }
    const result = await adaptLegacyRunner({ gateId: name, task });
    recordResult(name, result);
  };

  await runStep('structured-exceptions', () => {
    const result = inspectExceptionRegistry(config.exceptions);
    if (result.expired.length || result.future.length) return 2;
    return 0;
  });
  const dynamicCodeGate = gateRegistry.get('security.dynamic-code');
  const dynamicCodePlan = dynamicCodeGate.plan({
    root,
    config,
    files: projectFiles,
  });
  const dynamicCodeResult = dynamicCodeGate.run({ root, config, plan: dynamicCodePlan });
  for (const line of dynamicCodeGate.renderConsole(dynamicCodeResult)) {
    if (line.stream === 'stderr') console.error(line.message);
    else console.log(line.message);
  }
  recordResult('dynamic-code', dynamicCodeResult, {
    includeGateResult: true,
    exitCode: dynamicCodeResult.status === 'passed'
      ? 0
      : dynamicCodeResult.status === 'violation' ? 1 : null,
    includeDiagnostics: false,
  });
  await runStep('vue-unsafe-html', () => runUnsafeVueHtmlProject({
    root,
    exceptions: config.exceptions,
  }));
  await runStep('vue-target-blank', () => runVueTargetBlankProject({
    root,
    exceptions: config.exceptions,
  }));
  await runStep('vue-form-labels', () => runVueFormLabelProject({
    root,
    exceptions: config.exceptions,
  }));
  await runStep('vue-image-alt', () => runVueImageAltProject({
    root,
    exceptions: config.exceptions,
  }));
  await runStep('dependency-policy', () => runDependencyPolicy({
    root,
    config: config.dependencyPolicy,
    exceptions: config.exceptions,
  }), { enabled: config.dependencyPolicy.enabled });
  await runStep('file-placement', () => runFilePlacementProject({
    root,
    config: config.preCommit.filePlacement,
  }), { enabled: config.preCommit.filePlacement.enabled });
  await runStep('maximum-file-lines', () => {
    const files = selectMaxFileLineFiles(
      projectFiles.map((relative) => ({ relative, absolute: path.join(root, relative) })),
      config.preCommit.maxFileLines,
    );
    return runMaxFileLinesFiles({
      root,
      files,
      config: config.preCommit.maxFileLines,
      baselineRef: range.base,
      changes: range.changes,
    });
  }, { enabled: config.preCommit.maxFileLines.enabled });

  await runStep('unit-test-policy', () => {
    if (!config.unitTest.enabled) return 0;
    const policy = inspectUnitTestPolicy({ root, changes: range.changes, config: config.unitTest });
    if (policy.missingTests.length || policy.bypasses.length
      || policy.componentInteractions.length) {
      console.error(buildUnitTestAiInstructions({ ...policy, script: config.unitTest.script }));
      return 2;
    }
    return 0;
  }, { enabled: config.unitTest.enabled && profile === 'policy' });

  const protectedChanges = classifyChanges(range.changes, config);
  await runStep('protected-files', () => {
    if (protectedChanges.length === 0) return 0;
    for (const change of protectedChanges) {
      console.log(`Protected ${change.level}: ${change.path} (${change.category})`);
    }
    return config.ci.protectedFiles.action === 'fail' ? 2 : 0;
  });

  if (profile === 'full') {
    const styleFiles = matchingFiles(projectFiles, config.preCommit.stylelint.pattern);
    await runStep('stylelint', () => runStylelintFiles({
      root,
      files: styleFiles,
      fix: false,
      maxWarnings: config.preCommit.stylelint.maxWarnings,
      requireConfig: config.preCommit.stylelint.requireConfig,
      complexity: config.preCommit.stylelint.complexity,
      governance: config.preCommit.stylelint.governance,
      exceptions: config.exceptions,
    }), { enabled: config.preCommit.stylelint.enabled });
    await runStep('eslint', () => runEslintFiles({
      root,
      files: matchingFiles(projectFiles, config.preCommit.eslint.pattern),
      fix: false,
      maxWarnings: config.preCommit.eslint.maxWarnings,
      preset: config.preCommit.eslint.preset,
    }), { enabled: config.preCommit.eslint.enabled });
    await runStep('prettier', () => runPrettierFiles({
      root,
      files: matchingFiles(projectFiles, config.preCommit.prettier.pattern),
      fix: false,
      requireConfig: config.preCommit.prettier.requireConfig,
    }), { enabled: config.preCommit.prettier.enabled });
    await runStep('type-check', () => runTypeCheckGate({ root, config: config.typeCheck }), {
      enabled: config.typeCheck.enabled,
    });
    await runStep('unit-tests', () => runUnitTestGate({
      root,
      config: config.unitTest,
      changes: range.changes,
    }), { enabled: config.unitTest.enabled });
    await runStep('accessibility-tests', () => runAccessibilityTestGate({
      root,
      config: config.accessibilityTest,
    }), { enabled: config.accessibilityTest.enabled });
    await runStep('architecture', () => runArchitectureGate({
      root,
      config: config.architecture,
    }), { enabled: config.architecture.enabled });
    await runStep('build', () => runBuildGate({ root, config: config.build }), {
      enabled: config.build.enabled,
    });
  }

  const status = executionError ? 'error' : violation ? 'failed' : 'passed';
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
  return executionError ? 1 : violation ? 2 : 0;
}
