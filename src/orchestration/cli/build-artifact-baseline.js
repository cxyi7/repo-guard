import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import {
  initializeBuildArtifactBaseline,
  pruneBuildArtifactBaseline,
} from '../../gates/quality/build-artifact-baseline-management.js';
import { findRepositoryRoot } from '../../git/repository.js';

export function runBuildArtifactBaseline(action, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root).build.artifactBudget;
  const result = action === 'init'
    ? initializeBuildArtifactBaseline(root, config)
    : action === 'prune'
      ? pruneBuildArtifactBaseline(root, config)
      : null;
  if (!result) {
    throw configurationError('build-artifact/unknown-baseline-action', '产物基线操作必须为 init 或 prune');
  }
  if (result.action === 'initialized') {
    writeConsoleMessage(
      `构建产物基线已初始化：${result.baselineFile}，登记 ${result.debtCount} 项历史问题；请审核并提交该文件。`,
    );
  } else if (!result.changed) {
    writeConsoleMessage(`构建产物基线无需裁剪，仍包含 ${result.before} 项历史问题。`);
  } else {
    writeConsoleMessage(
      `构建产物基线已安全裁剪：${result.before} → ${result.after}；请审核并提交该文件。`,
    );
  }
  return 0;
}
