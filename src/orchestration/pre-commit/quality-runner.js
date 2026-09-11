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
import { EXIT_CODES } from '../../core/result/exit-code.js';
import { internalError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { orchestratePlan } from '../orchestrator.js';
import { preCommitQualityPlan } from './protected-plan.js';
import { synchronizeStagedFileHeaders } from './file-header-normalizer.js';
import { synchronizeStagedFunctionDocumentation } from './function-documentation-normalizer.js';
import { scopeProjectFiles, projectStepLabel, projectAffected, projectConfigurationChanged } from '../workspace/targets.js';

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
    checks: {
      ...config.checks,
      eslint: { ...config.checks.eslint, enabled: eslintFiles.length > 0 },
      prettier: { ...config.checks.prettier, enabled: prettierFiles.length > 0 },
      stylelint: { ...config.checks.stylelint, enabled: stylelintFiles.length > 0 },
      maxFileLines: {
        ...config.checks.maxFileLines,
        enabled: maxFileLineFiles.length > 0,
      },
      filePlacement: {
        ...config.checks.filePlacement,
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
  } = config.checks;
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
  const uiTokenConfig = config.checks.uiTokens;
  const uiTokenFiles = selectUiTokenInputFiles(normalizedFiles, uiTokenConfig);
  const javaEnabled = config.project?.stack === 'java'
    && Object.entries(config.checks).some(([feature, value]) => feature.startsWith('java') && value.enabled);
  const javaFiles = javaEnabled
    ? normalizedFiles.filter(({ relative }) => relative.endsWith('.java')).map(({ absolute }) => absolute)
    : [];
  return Object.freeze({
    javaEnabled,
    javaFiles,
    javaPolicyFiles: javaEnabled ? normalizedFiles.map(({ absolute }) => absolute) : [],
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
      javaFiles,
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
    exitCode: EXIT_CODES.success,
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
  return await gate.run({ ...context, plan: gatePlan });
}

async function executeQualityStep({ gate, step, stepContext, selection }) {
  if (step.gateId === 'java.path-naming') {
    return runGateWithFiles(gate, stepContext);
  }
  if (step.gateId.startsWith('java.')) {
    return runGateWithFiles(gate, {
      ...stepContext,
      javaFix: step.id === 'java.format-fix',
    }, step.gateId === 'java.files' ? selection.javaPolicyFiles : selection.javaFiles);
  }
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
      if (selection.eslintFiles.length > 0) {
        return runGateWithFiles(gate, stepContext, selection.eslintFiles);
      }
      break;
    case 'quality.ui-tokens':
      if (
        selection.uiTokenConfig.enabled
        && (
          selection.uiTokenFiles.length > 0
          || stepContext.configurationChanged
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

function skipUnmatchedJavaStep({ context, gate, step }) {
  if (!gate.id.startsWith('java.') || ['java.files', 'java.path-naming'].includes(gate.id)) return null;
  const settings = context.config.checks[gate.featureName];
  const hasSource = context.files.some(({ relative }) => relative.endsWith('.java')
    && micromatch.isMatch(relative, settings.include, { dot: true })
    && !micromatch.isMatch(relative, settings.exclude, { dot: true }));
  if (!hasSource && (!context.configurationChanged || step.id === 'java.format-fix')) {
    return skipped(step, '当前暂存范围没有匹配的 Java 源码，无需启动源码检查工具');
  }
  return null;
}

function prepareQualityProject({ root, repositoryRoot = root, files, config, configurationChanged = false }) {
  const normalizedFiles = normalizeStagedFiles(root, files, '质量门禁');
  const selection = selectQualityFiles(normalizedFiles, config);
  const stagedChanges = collectStagedChanges(root);
  const hasStagedDeletion = stagedChanges.some(({ status }) => status.startsWith('D'));

  if (
    selection.relevantFiles.length === 0
    && !selection.filePlacementConfig.enabled
    && !selection.pathNamingConfig.enabled
    && !(selection.uiTokenConfig.enabled && (hasStagedDeletion || configurationChanged))
    && !selection.javaEnabled
  ) {
    return null;
  }

  return { root, repositoryRoot, config, configurationChanged, normalizedFiles, selection, stagedChanges };
}

function normalizeProjectContents({ root, selection, stagedChanges }) {
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
}

function qualityContext({ root, repositoryRoot, config, configurationChanged, selection, normalizedFiles, stagedChanges }) {
    return createGateContext({
      root,
      repositoryRoot,
      configurationChanged,
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
}

async function executeQualityProjects(projects) {
  const prepared = projects.map(prepareQualityProject).filter(Boolean);
  if (prepared.length === 0) return emptyQualityExecution();
  const originalContents = captureFileContents(prepared.flatMap(({ selection }) => selection.relevantFiles));
  try {
    for (const project of prepared) normalizeProjectContents(project);
    const contexts = prepared.map(qualityContext);
    const selections = new Map(prepared.map(({ root, selection }) => [root, selection]));
    const execution = await orchestratePlan({
      plan: preCommitQualityPlan,
      registry: gateRegistry,
      context: contexts[0],
      contextsForStep: () => contexts,
      stopOnFailure: true,
      beforeStep: skipUnmatchedJavaStep,
      executeStep: (stepArguments) => executeQualityStep({
        ...stepArguments,
        stepContext: stepArguments.context,
        selection: selections.get(stepArguments.context.root),
      }),
      onResult: ({ context, result, step }) => writeGateResultConsole(result, {
        label: projectStepLabel(context, step),
      }),
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

export async function runQualityExecution({ root, files, config }) {
  const configurationChanged = collectStagedChanges(root).some(({ path: current, oldPath }) => (
    current === 'repo-guard.config.json' || oldPath === 'repo-guard.config.json'
  ));
  return await executeQualityProjects([{ root, files, config, configurationChanged }]);
}

export async function runWorkspaceQualityExecution(workspace, files) {
  const normalized = normalizeStagedFiles(workspace.root, files, '工作区质量门禁');
  const changes = collectStagedChanges(workspace.root);
  const projects = workspace.projects.filter((project) => projectAffected(workspace, project, changes)).map((project) => ({
    root: project.root,
    repositoryRoot: workspace.root,
    config: project.config,
    configurationChanged: projectConfigurationChanged(workspace, project, changes),
    files: scopeProjectFiles(normalized, workspace.root, project).map(({ absolute }) => absolute),
  }));
  return await executeQualityProjects(projects);
}
