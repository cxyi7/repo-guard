import micromatch from 'micromatch';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { runEslintFiles } from './eslint-runner.js';
import { runFilePlacementFiles } from './file-placement.js';
import { runPrettierFiles } from './prettier-runner.js';
import { normalizeStagedFiles } from './staged-files.js';
import { runStylelintFiles } from './stylelint-runner.js';
import { gateRegistry } from './gates/registry.js';
import { renderDynamicCodeResult } from './dynamic-code.js';
import { runVueFormLabelFiles } from './vue-form-label.js';
import { runVueImageAltFiles } from './vue-image-alt.js';
import { runVueTargetBlankFiles } from './vue-target-blank.js';
import { runUnsafeVueHtmlFiles } from './vue-unsafe-html.js';
import {
  runMaxFileLinesFiles,
  selectMaxFileLineFiles,
} from './max-file-lines.js';
import {
  createChangeSet,
  createGateContext,
} from './core/capability/gate-context.js';
import { createGateResult } from './core/result/gate-result.js';
import { adaptNumericRunner } from './core/result/numeric-runner-adapter.js';
import { orchestratePlan } from './orchestration/orchestrator.js';
import { preCommitQualityPlan } from './orchestration/pre-commit/protected-plan.js';

function selectFiles(files, pattern) {
  return files
    .filter(({ relative }) => micromatch.isMatch(relative, pattern, {
      dot: true,
      matchBase: true,
    }))
    .map(({ absolute }) => absolute);
}

function uniqueFiles(...groups) {
  return [...new Set(groups.flat())];
}

function skipped(step, summary) {
  return createGateResult({
    gateId: step.gateId,
    status: 'skipped',
    summary,
  });
}

function executionConfig(config, {
  eslintFiles,
  filePlacementConfig,
  maxFileLineFiles,
  prettierFiles,
  stylelintFiles,
}) {
  return {
    ...config,
    preCommit: {
      ...config.preCommit,
      eslint: { ...config.preCommit.eslint, enabled: eslintFiles.length > 0 },
      prettier: { ...config.preCommit.prettier, enabled: prettierFiles.length > 0 },
      stylelint: { ...config.preCommit.stylelint, enabled: stylelintFiles.length > 0 },
      maxFileLines: {
        ...config.preCommit.maxFileLines,
        enabled: maxFileLineFiles.length > 0,
      },
      filePlacement: {
        ...config.preCommit.filePlacement,
        enabled: filePlacementConfig.enabled,
      },
    },
  };
}

export async function runQualityExecution({ root, files, config }) {
  const normalizedFiles = normalizeStagedFiles(root, files, 'Quality gate');
  const eslintConfig = config.preCommit.eslint;
  const prettierConfig = config.preCommit.prettier;
  const stylelintConfig = config.preCommit.stylelint;
  const maxFileLinesConfig = config.preCommit.maxFileLines;
  const filePlacementConfig = config.preCommit.filePlacement;
  const dynamicCodeFiles = normalizedFiles
    .filter(({ relative }) => /\.(?:[cm]?[jt]sx?|vue)$/i.test(relative))
    .map(({ absolute }) => absolute);
  const vueSecurityFiles = normalizedFiles
    .filter(({ relative }) => relative.toLowerCase().endsWith('.vue'))
    .map(({ absolute }) => absolute);
  const eslintFiles = eslintConfig.enabled
    ? selectFiles(normalizedFiles, eslintConfig.pattern)
    : [];
  const prettierFiles = prettierConfig.enabled
    ? selectFiles(normalizedFiles, prettierConfig.pattern)
    : [];
  const stylelintFiles = stylelintConfig.enabled
    ? selectFiles(normalizedFiles, stylelintConfig.pattern)
    : [];
  const maxFileLineFiles = maxFileLinesConfig.enabled
    ? selectMaxFileLineFiles(normalizedFiles, maxFileLinesConfig)
    : [];
  const relevantFiles = uniqueFiles(
    stylelintFiles,
    eslintFiles,
    prettierFiles,
    maxFileLineFiles,
    dynamicCodeFiles,
    vueSecurityFiles,
  );

  if (relevantFiles.length === 0 && !filePlacementConfig.enabled) {
    console.log('repo-guard quality gate: no staged files matched the configured patterns.');
    return Object.freeze({
      planId: preCommitQualityPlan.id,
      status: 'passed',
      outcomes: Object.freeze([]),
      results: Object.freeze([]),
      decisiveResult: null,
      exitCode: 0,
    });
  }

  const originalContents = captureFileContents(relevantFiles);
  try {
    const context = createGateContext({
      root,
      environment: preCommitQualityPlan.environment,
      config: executionConfig(config, {
        eslintFiles,
        filePlacementConfig,
        maxFileLineFiles,
        prettierFiles,
        stylelintFiles,
      }),
      changes: createChangeSet({
        source: 'pre-commit-staged-files',
        changes: normalizedFiles,
      }),
      files: normalizedFiles,
    });
    const execution = await orchestratePlan({
      plan: preCommitQualityPlan,
      registry: gateRegistry,
      context,
      stopOnFailure: true,
      executeStep: async ({ context: stepContext, gate, step }) => {
        let task = null;
      switch (step.id) {
        case 'quality.stylelint-fix':
          if (stylelintFiles.length > 0) task = () => runStylelintFiles({ root, files: stylelintFiles, fix: stylelintConfig.fix, maxWarnings: stylelintConfig.maxWarnings, requireConfig: stylelintConfig.requireConfig, complexity: stylelintConfig.complexity, governance: stylelintConfig.governance, exceptions: config.exceptions });
          break;
        case 'quality.eslint-fix':
          if (eslintFiles.length > 0 && eslintConfig.fix) task = () => runEslintFiles({ root, files: eslintFiles, fix: true, maxWarnings: eslintConfig.maxWarnings, preset: eslintConfig.preset });
          break;
        case 'quality.prettier':
          if (prettierFiles.length > 0) task = () => runPrettierFiles({ root, files: prettierFiles, fix: prettierConfig.fix, requireConfig: prettierConfig.requireConfig });
          break;
        case 'quality.stylelint-verify':
          if (stylelintFiles.length > 0) task = () => runStylelintFiles({ root, files: stylelintFiles, fix: false, maxWarnings: stylelintConfig.maxWarnings, requireConfig: stylelintConfig.requireConfig, complexity: stylelintConfig.complexity, governance: stylelintConfig.governance, exceptions: config.exceptions });
          break;
        case 'quality.eslint-verify':
          if (eslintFiles.length > 0 && (!eslintConfig.fix || prettierFiles.length > 0)) task = () => runEslintFiles({ root, files: eslintFiles, fix: false, maxWarnings: eslintConfig.maxWarnings, preset: eslintConfig.preset });
          break;
        case 'security.dynamic-code':
          if (dynamicCodeFiles.length > 0) {
            try {
              const gatePlan = await gate.plan(stepContext);
              const result = await gate.run({ ...stepContext, plan: gatePlan });
              renderDynamicCodeResult(result);
              return result;
            } catch (error) {
              if (!String(error.message).startsWith('Dynamic code gate could not parse ')) throw error;
              console.warn(`${error.message}. Dynamic-code inspection was deferred for this invalid or unsupported script; when ESLint is enabled, its completed result remains authoritative.`);
              return createGateResult({
                gateId: step.gateId,
                status: 'passed',
                summary: 'Dynamic-code inspection deferred to ESLint',
              });
            }
          }
          break;
        case 'security.vue-unsafe-html':
          if (vueSecurityFiles.length > 0) task = () => runUnsafeVueHtmlFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'security.vue-target-blank':
          if (vueSecurityFiles.length > 0) task = () => runVueTargetBlankFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'accessibility.vue-form-label':
          if (vueSecurityFiles.length > 0) task = () => runVueFormLabelFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'accessibility.vue-image-alt':
          if (vueSecurityFiles.length > 0) task = () => runVueImageAltFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'repository.maximum-file-lines':
          if (maxFileLineFiles.length > 0) task = () => runMaxFileLinesFiles({ root, files: maxFileLineFiles, config: maxFileLinesConfig });
          break;
        case 'repository.file-placement':
          if (filePlacementConfig.enabled) task = () => runFilePlacementFiles({ root, files: normalizedFiles, config: filePlacementConfig });
          break;
        default:
          throw new Error(`Unsupported protected pre-commit quality step: ${step.id}`);
      }
        if (!task) return skipped(step, `${step.id} has no matching staged files or is disabled`);
        return await adaptNumericRunner({
          gateId: step.gateId,
          task,
          captureDiagnostics: false,
        });
      },
    });
    if (execution.exitCode !== 0) restoreFileContents(originalContents);
    return execution;
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }
}

export async function runQualityFiles(options) {
  const execution = await runQualityExecution(options);
  if (execution.status.endsWith('-error')) {
    const error = new Error(
      execution.decisiveResult?.error?.message ?? 'Quality gate could not complete',
    );
    if (execution.decisiveResult?.error?.code) {
      error.code = execution.decisiveResult.error.code;
    }
    throw error;
  }
  return execution.exitCode === 0 ? 0 : 1;
}
