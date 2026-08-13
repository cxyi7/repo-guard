import micromatch from 'micromatch';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { normalizeStagedFiles } from './staged-files.js';
import { gateRegistry } from './gates/registry.js';
import { renderDynamicCodeResult } from './gates/security/dynamic-code-renderer.js';
import {
  selectMaxFileLineFiles,
} from './max-file-lines.js';
import { collectStagedChanges } from './git-changes.js';
import {
  createChangeSet,
  createGateContext,
} from './core/capability/gate-context.js';
import { createGateResult } from './core/result/gate-result.js';
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
            try {
              const gatePlan = await gate.plan(stepContext);
              const result = await gate.run({ ...stepContext, plan: gatePlan });
              for (const line of renderDynamicCodeResult(result)) {
                if (line.stream === 'stderr') console.error(line.message);
                else console.log(line.message);
              }
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
          throw new Error(`Unsupported protected pre-commit quality step: ${step.id}`);
      }
        return skipped(step, `${step.id} has no matching staged files or is disabled`);
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
