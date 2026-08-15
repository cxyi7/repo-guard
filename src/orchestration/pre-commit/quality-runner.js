import micromatch from 'micromatch';
import {
  captureFileContents,
  restoreFileContents,
} from '../../core/execution/file-snapshot.js';
import { normalizeStagedFiles } from '../../core/execution/staged-files.js';
import { gateRegistry } from '../../gates/registry.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import {
  selectMaxFileLineFiles,
} from '../../policies/max-file-lines.js';
import { collectStagedChanges } from '../../git-changes.js';
import {
  createChangeSet,
  createGateContext,
} from '../../core/capability/gate-context.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { internalError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { orchestratePlan } from '../orchestrator.js';
import { preCommitQualityPlan } from './protected-plan.js';

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
        changes: collectStagedChanges(root),
      }),
      files: normalizedFiles,
    });
    const execution = await orchestratePlan({
      plan: preCommitQualityPlan,
      registry: gateRegistry,
      context,
      stopOnFailure: true,
      executeStep: async ({ context: stepContext, gate, step }) => {
      switch (step.id) {
        case 'quality.stylelint-fix':
          if (stylelintFiles.length === 0) break;
          {
            const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: stylelintFiles }));
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        case 'quality.eslint-fix':
          if (eslintFiles.length === 0 || !eslintConfig.fix) break;
          {
            const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: eslintFiles }));
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        case 'quality.prettier':
          if (prettierFiles.length === 0) break;
          {
            const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: prettierFiles }));
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        case 'quality.stylelint-verify':
          if (stylelintFiles.length === 0) break;
          {
            const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: stylelintFiles }));
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        case 'quality.eslint-verify':
          if (eslintFiles.length === 0 || (eslintConfig.fix && prettierFiles.length === 0)) break;
          {
            const gatePlan = await gate.plan(Object.freeze({ ...stepContext, files: eslintFiles }));
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        case 'security.dynamic-code':
          if (dynamicCodeFiles.length > 0) {
            const gatePlan = await gate.plan(stepContext);
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
          break;
        case 'security.vue-unsafe-html':
        case 'security.vue-target-blank':
        case 'accessibility.vue-form-label':
        case 'accessibility.vue-image-alt':
        case 'repository.maximum-file-lines':
        case 'repository.file-placement':
          if (step.id.startsWith('security.') || step.id.startsWith('accessibility.')) {
            if (vueSecurityFiles.length === 0) break;
          }
          if (step.id === 'repository.maximum-file-lines' && maxFileLineFiles.length === 0) break;
          if (step.id === 'repository.file-placement' && !filePlacementConfig.enabled) break;
          {
            const gatePlan = await gate.plan(stepContext);
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        default:
          throw internalError('pre-commit/unsupported-quality-step', `Unsupported protected pre-commit quality step: ${step.id}`);
      }
        return skipped(step, `${step.id} has no matching staged files or is disabled`);
      },
      onResult: ({ result, step }) => writeGateResultConsole(result, { label: step.id }),
    });
    if (execution.exitCode !== 0) restoreFileContents(originalContents);
    return execution;
  } catch (error) {
    restoreFileContents(originalContents);
    throw toRepoGuardError(error, {
      kind: 'execution',
      code: 'pre-commit/quality-execution-failed',
    });
  }
}
