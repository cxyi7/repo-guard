import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { collectSassStyleFacts } from '../../integrations/ui-tokens/sass.js';
import { loadUiTokenManifest } from '../../integrations/ui-tokens/manifest.js';
import { collectUnoCssFacts } from '../../integrations/ui-tokens/unocss.js';
import { collectUnoCssConfigurationFacts } from '../../integrations/ui-tokens/unocss-configuration.js';
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
const SASS_FILE = /\.(?:scss|sass|vue)$/i;
const UNOCSS_FILE = /\.(?:vue|html|js|jsx|ts|tsx)$/i;

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
    ...(config.adapters.unocss.enabled ? config.adapters.unocss.configFiles : []),
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
  return changed.has('repo-guard.config.json')
    || changed.has(config.manifestFile)
    || manifest.sources.some(({ path: source }) => changed.has(source))
    || (
      config.adapters.unocss.enabled
      && config.adapters.unocss.configFiles.some((file) => changed.has(file))
    );
}

function inspectSetup({ root, config }) {
  if (!config.uiTokens.enabled) return readyGateSetup('UI Token 门禁已禁用');
  loadUiTokenManifest(root, config.uiTokens);
  if (config.uiTokens.adapters.sass.enabled) {
    const stylelint = resolveProjectStylelintMetadata(root);
    if (!findProjectStylelintConfig(root)) {
      throw configurationError(
        'ui-token/missing-stylelint-config',
        'UI Token 的 Sass 适配器要求消费项目提供 Stylelint 配置',
      );
    }
    return readyGateSetup(`UI Token 门禁（Sass 使用 Stylelint ${stylelint.version}）`);
  }
  return readyGateSetup('UI Token 门禁（UnoCSS 适配器）');
}

export const uiTokenGate = definePlatformGate({
  id: UI_TOKEN_GATE_ID,
  configKey: 'uiTokens',
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
  plan({ root, config, files, changes }) {
    if (!config.uiTokens.enabled) return Object.freeze({ enabled: false, files: [] });
    const manifest = loadUiTokenManifest(root, config.uiTokens);
    const projectFiles = contractChanged(
      config.uiTokens,
      manifest,
      changes,
    ) ? collectProjectFiles(root) : files;
    return Object.freeze({
      enabled: true,
      manifest,
      deletedContractPaths: Object.freeze(deletedContractPaths(
        config.uiTokens,
        manifest,
        changes,
      )),
      files: Object.freeze(selectedFiles(root, projectFiles, config.uiTokens)),
    });
  },
  async run({ root, config, plan }) {
    if (!plan.enabled) return skippedResult(UI_TOKEN_GATE_ID, 'UI Token 门禁已禁用');
    const sassFiles = plan.files
      .filter(({ relative }) => config.uiTokens.adapters.sass.enabled && SASS_FILE.test(relative))
      .map(({ absolute }) => absolute);
    const unoFiles = plan.files.filter(({ relative }) => (
      config.uiTokens.adapters.unocss.enabled && UNOCSS_FILE.test(relative)
    ));
    const project = sassFiles.length > 0 ? await loadProjectStylelint(root) : null;
    const manifestSourcePaths = new Set(plan.manifest.sources.map(({ path: source }) => source));
    const unoConfigFiles = config.uiTokens.adapters.unocss.enabled
      ? config.uiTokens.adapters.unocss.configFiles.filter((file) => manifestSourcePaths.has(file))
      : [];
    const [sassFacts, unocssFacts, unocssConfigurationFacts] = await Promise.all([
      project
        ? collectSassStyleFacts({ project, root, files: sassFiles })
        : [],
      collectUnoCssFacts({
        root,
        files: unoFiles,
        config: config.uiTokens.adapters.unocss,
      }),
      collectUnoCssConfigurationFacts({ root, files: unoConfigFiles }),
    ]);
    const result = inspectUiTokens({
      config: { ...config.uiTokens, exceptions: config.exceptions },
      manifest: plan.manifest,
      deletedContractPaths: plan.deletedContractPaths,
      sassFacts,
      unocssFacts,
      unocssConfigurationFacts,
    });
    const metrics = {
      checkedFiles: plan.files.length,
      checkedSassFacts: result.checkedSassFacts,
      checkedUnoCssFacts: result.checkedUnoCssFacts,
      checkedUnoCssConfigurationFacts: result.checkedUnoCssConfigurationFacts,
      approvedExceptions: result.approved.length,
      violations: result.violations.length,
    };
    if (result.violations.length === 0) {
      return passedResult(
        UI_TOKEN_GATE_ID,
        `UI Token 门禁已通过，共检查 ${plan.files.length} 个文件`,
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
