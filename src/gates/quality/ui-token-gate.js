import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { collectStyleFacts, isUiTokenStyleFile } from '../../integrations/ui-tokens/styles.js';
import { loadUiTokenManifest } from '../../integrations/ui-tokens/manifest.js';
import {
  inspectUiTokens,
  UI_TOKEN_RULES,
} from '../../policies/ui-tokens.js';
import {
  findProjectStylelintConfig,
  loadProjectStylelint,
  resolveProjectStylelintMetadata,
} from '../../integrations/stylelint/project.js';
import { findingFromPolicy, passedResult, skippedResult, violationResult } from '../native-result.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';

export const UI_TOKEN_GATE_ID = 'quality.ui-tokens';

function relativePath(root, file) {
  if (typeof file !== 'string') return file.relative;
  return (path.isAbsolute(file) ? path.relative(root, file) : file).replaceAll('\\', '/');
}

function absolutePath(root, file) {
  if (typeof file !== 'string') return file.absolute;
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function selectedFiles(root, files, config) {
  return files.filter((file) => {
    const relative = relativePath(root, file);
    return micromatch.isMatch(relative, config.include, { dot: true })
      && !micromatch.isMatch(relative, config.exclude, { dot: true });
  }).map((file) => ({
    absolute: absolutePath(root, file),
    relative: relativePath(root, file),
  }));
}

function changedPaths(changes) {
  return new Set((changes?.entries ?? []).flatMap(({ path: current, oldPath }) => (
    [current, oldPath].filter(Boolean)
  )));
}

function deletedContractPaths(config, manifest, changes) {
  const contractPaths = new Set([
    config.manifestFile,
    ...manifest.sources.map(({ path: source }) => source),
  ]);
  return (changes?.entries ?? []).flatMap(({ path: changedPath, oldPath, status }) => {
    if (typeof status !== 'string') return [];
    if (status.startsWith('D') && contractPaths.has(changedPath)) return [changedPath];
    if (status.startsWith('R') && oldPath && contractPaths.has(oldPath)) return [oldPath];
    return [];
  });
}

function contractChanged(config, manifest, changes) {
  const changed = changedPaths(changes);
  return changed.has(config.manifestFile)
    || manifest.sources.some(({ path: source }) => changed.has(source));
}

function inspectSetup({ root, config }) {
  if (!config.checks.uiTokens.enabled) return readyGateSetup('UI Token 门禁已禁用');
  loadUiTokenManifest(root, config.checks.uiTokens);
  const stylelint = resolveProjectStylelintMetadata(root);
  if (!findProjectStylelintConfig(root)) {
    throw configurationError(
      'ui-token/missing-stylelint-config',
      'UI Token 样式检查要求消费项目提供 Stylelint 配置',
    );
  }
  return readyGateSetup(`UI Token 门禁（${config.checks.uiTokens.languages.join('、')} 使用 Stylelint ${stylelint.version}）`);
}

export const uiTokenGate = definePlatformGate({
  id: UI_TOKEN_GATE_ID,
  configKey: 'checks.uiTokens',
  featureName: 'uiTokens',
  featureOrder: 39,
  doctorOrder: 147,
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  manualCommand: 'ui-tokens',
  manualOrder: 147,
  packageScript: 'guard:ui-tokens',
  rules: UI_TOKEN_RULES,
  inspectSetup,
  plan({ root, config, files, changes, configurationChanged = false }) {
    if (!config.checks.uiTokens.enabled) return Object.freeze({ enabled: false, files: [] });
    const manifest = loadUiTokenManifest(root, config.checks.uiTokens);
    const projectFiles = configurationChanged || contractChanged(
      config.checks.uiTokens,
      manifest,
      changes,
    ) ? collectProjectFiles(root) : files;
    return Object.freeze({
      enabled: true,
      manifest,
      deletedContractPaths: Object.freeze(deletedContractPaths(
        config.checks.uiTokens,
        manifest,
        changes,
      )),
      files: Object.freeze(selectedFiles(root, projectFiles, config.checks.uiTokens)),
    });
  },
  async run({ root, config, plan }) {
    if (!plan.enabled) return skippedResult(UI_TOKEN_GATE_ID, 'UI Token 门禁已禁用');
    const styleFiles = plan.files
      .filter(({ absolute }) => isUiTokenStyleFile(absolute, config.checks.uiTokens.languages))
      .map(({ absolute }) => absolute);
    const project = styleFiles.length > 0 ? await loadProjectStylelint(root) : null;
    const styleFacts = project ? await collectStyleFacts({
      project, root, files: styleFiles, languages: config.checks.uiTokens.languages,
    }) : [];
    const result = inspectUiTokens({
      config: { ...config.checks.uiTokens, exceptions: config.repository.exceptions },
      manifest: plan.manifest,
      deletedContractPaths: plan.deletedContractPaths,
      styleFacts,
    });
    const metrics = {
      checkedFiles: styleFiles.length,
      checkedStyleFacts: result.checkedStyleFacts,
      approvedExceptions: result.approved.length,
      violations: result.violations.length,
    };
    if (result.violations.length === 0) {
      return passedResult(
        UI_TOKEN_GATE_ID,
        `UI Token 门禁已通过，共检查 ${styleFiles.length} 个文件`,
        { metrics },
      );
    }
    return violationResult(
      UI_TOKEN_GATE_ID,
      `UI Token 门禁发现 ${result.violations.length} 项阻断错误`,
      {
        metrics,
        findings: result.violations.map((finding) => findingFromPolicy(finding)),
      },
    );
  },
});
