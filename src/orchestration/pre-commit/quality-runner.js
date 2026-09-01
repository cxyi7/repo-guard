import micromatch from 'micromatch';
import {
  captureFileContents,
  restoreFileContents,
} from '../../core/execution/file-snapshot.js';
import { normalizeStagedFiles } from '../../core/execution/staged-files.js';
import { gateRegistry } from '../../gates/registry.js';
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from '../../core/report/console-renderer.js';
import {
  selectMaxFileLineFiles,
} from '../../policies/max-file-lines.js';
import { selectFileHeaderFiles } from '../../policies/file-header.js';
import { selectFunctionDocumentationFiles } from '../../policies/function-documentation.js';
import { selectAsyncResourceCleanupFiles } from '../../policies/async-resource-cleanup.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import {
  createChangeSet,
  createGateContext,
} from '../../core/capability/gate-context.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { internalError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { orchestratePlan } from '../orchestrator.js';
import { preCommitQualityPlan } from './protected-plan.js';
import { synchronizeStagedFileHeaders } from './file-header-normalizer.js';
import { synchronizeStagedFunctionDocumentation } from './function-documentation-normalizer.js';

function selectFiles(files, pattern) {
  return files
    .filter(({ relative }) => micromatch.isMatch(relative, pattern, {
      dot: true,
      matchBase: true,
    }))
    .map(({ absolute }) => absolute);
}

function selectUiTokenInputFiles(files, config) {
  if (!config.enabled) return [];
  return files.map(({ absolute }) => absolute);
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

function selectQualityFiles(normalizedFiles, config) {
  const {
    asyncResourceCleanup: asyncResourceCleanupConfig,
    eslint: eslintConfig,
    fileHeader: fileHeaderConfig,
    filePlacement: filePlacementConfig,
    functionDocs: functionDocsConfig,
    maxFileLines: maxFileLinesConfig,
    pathNaming: pathNamingConfig,
    prettier: prettierConfig,
    stylelint: stylelintConfig,
  } = config.preCommit;
  const asyncResourceFiles = selectAsyncResourceCleanupFiles(
    normalizedFiles,
    asyncResourceCleanupConfig,
  ).map(({ absolute }) => absolute);
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
  const fileHeaderFiles = selectFileHeaderFiles(normalizedFiles, fileHeaderConfig);
  const functionDocFiles = selectFunctionDocumentationFiles(normalizedFiles, functionDocsConfig);
  const uiTokenConfig = config.uiTokens;
  const uiTokenFiles = selectUiTokenInputFiles(normalizedFiles, uiTokenConfig);
  return Object.freeze({
    asyncResourceFiles,
    dynamicCodeFiles,
    eslintConfig,
    eslintFiles,
    fileHeaderFiles,
    filePlacementConfig,
    functionDocFiles,
    maxFileLineFiles,
    pathNamingConfig,
    prettierFiles,
    relevantFiles: uniqueFiles(
      fileHeaderFiles,
      functionDocFiles,
      stylelintFiles,
      eslintFiles,
      prettierFiles,
      maxFileLineFiles,
      asyncResourceFiles,
      dynamicCodeFiles,
      vueSecurityFiles,
      uiTokenFiles,
    ),
    stylelintFiles,
    uiTokenConfig,
    uiTokenFiles,
    vueSecurityFiles,
  });
}

function emptyQualityExecution() {
  return Object.freeze({
    planId: preCommitQualityPlan.id,
    status: 'passed',
    outcomes: Object.freeze([]),
    results: Object.freeze([]),
    decisiveResult: null,
    exitCode: 0,
  });
}

function writeFunctionDocumentationWarnings(warnings) {
  for (const warning of warnings) {
    const { location } = warning;
    const position = [location.line, location.column]
      .filter((value) => value != null)
      .join(':');
    writeConsoleMessage(
      `警告  functionDocs [${warning.code}] ${location.path}${position ? `:${position}` : ''}：${warning.message}`,
      'stderr',
    );
  }
}

async function runGateWithFiles(gate, stepContext, files = null) {
  const context = files == null
    ? stepContext
    : Object.freeze({ ...stepContext, files });
  const gatePlan = await gate.plan(context);
  return await gate.run({ ...stepContext, plan: gatePlan });
}

async function executeQualityStep({ gate, step, stepContext, selection }) {
  switch (step.id) {
    case 'quality.stylelint-fix':
    case 'quality.stylelint-verify':
      if (selection.stylelintFiles.length > 0) {
        return runGateWithFiles(gate, stepContext, selection.stylelintFiles);
      }
      break;
    case 'quality.eslint-fix':
      if (selection.eslintFiles.length > 0 && selection.eslintConfig.fix) {
        return runGateWithFiles(gate, stepContext, selection.eslintFiles);
      }
      break;
    case 'quality.prettier':
      if (selection.prettierFiles.length > 0) {
        return runGateWithFiles(gate, stepContext, selection.prettierFiles);
      }
      break;
    case 'quality.eslint-verify':
      if (
        selection.eslintFiles.length > 0
        && (!selection.eslintConfig.fix || selection.prettierFiles.length > 0)
      ) {
        return runGateWithFiles(gate, stepContext, selection.eslintFiles);
      }
      break;
    case 'quality.ui-tokens':
      if (
        selection.uiTokenConfig.enabled
        && (
          selection.uiTokenFiles.length > 0
          || stepContext.changes.entries.some(({ status }) => status.startsWith('D'))
        )
      ) {
        return runGateWithFiles(gate, stepContext, selection.uiTokenFiles);
      }
      break;
    case 'quality.vue-async-resource-cleanup':
      if (selection.asyncResourceFiles.length > 0) {
        return runGateWithFiles(gate, stepContext, selection.asyncResourceFiles);
      }
      break;
    case 'repository.path-naming':
      if (selection.pathNamingConfig.enabled) return runGateWithFiles(gate, stepContext);
      break;
    case 'security.dynamic-code':
      if (selection.dynamicCodeFiles.length > 0) return runGateWithFiles(gate, stepContext);
      break;
    case 'security.vue-unsafe-html':
    case 'security.vue-target-blank':
    case 'accessibility.vue-form-label':
    case 'accessibility.vue-image-alt':
      if (selection.vueSecurityFiles.length > 0) return runGateWithFiles(gate, stepContext);
      break;
    case 'repository.maximum-file-lines':
      if (selection.maxFileLineFiles.length > 0) return runGateWithFiles(gate, stepContext);
      break;
    case 'repository.file-placement':
      if (selection.filePlacementConfig.enabled) return runGateWithFiles(gate, stepContext);
      break;
    default:
      throw internalError(
        'pre-commit/unsupported-quality-step',
        `不支持的受保护 pre-commit 质量步骤： ${step.id}`,
      );
  }
  return skipped(step, `${step.id} 没有匹配的暂存文件或已被禁用`);
}

export async function runQualityExecution({ root, files, config }) {
  const normalizedFiles = normalizeStagedFiles(root, files, '质量门禁');
  const selection = selectQualityFiles(normalizedFiles, config);
  const stagedChanges = collectStagedChanges(root);
  const hasStagedDeletion = stagedChanges.some(({ status }) => status.startsWith('D'));

  if (
    selection.relevantFiles.length === 0
    && !selection.filePlacementConfig.enabled
    && !selection.pathNamingConfig.enabled
    && !(selection.uiTokenConfig.enabled && hasStagedDeletion)
  ) {
    return emptyQualityExecution();
  }

  const originalContents = captureFileContents(selection.relevantFiles);
  try {
    synchronizeStagedFileHeaders({
      root,
      files: selection.fileHeaderFiles,
      changes: stagedChanges,
    });
    const functionDocResult = synchronizeStagedFunctionDocumentation({
      root,
      files: selection.functionDocFiles,
    });
    writeFunctionDocumentationWarnings(functionDocResult.warnings);
    const context = createGateContext({
      root,
      environment: preCommitQualityPlan.environment,
      config: executionConfig(config, {
        eslintFiles: selection.eslintFiles,
        filePlacementConfig: selection.filePlacementConfig,
        maxFileLineFiles: selection.maxFileLineFiles,
        prettierFiles: selection.prettierFiles,
        stylelintFiles: selection.stylelintFiles,
      }),
      changes: createChangeSet({
        source: 'pre-commit-staged-files',
        changes: stagedChanges,
      }),
      files: normalizedFiles,
    });
    const execution = await orchestratePlan({
      plan: preCommitQualityPlan,
      registry: gateRegistry,
      context,
      stopOnFailure: true,
      executeStep: (stepArguments) => executeQualityStep({
        ...stepArguments,
        stepContext: stepArguments.context,
        selection,
      }),
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
