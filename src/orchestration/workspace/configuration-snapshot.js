import { loadWorkspace } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';

export function loadWorkspaceSnapshot(root, revision, options = {}) {
  return loadWorkspace(root, {
    ...options,
    readDocument: (relativePath) => {
      const result = runGit(['show', `${revision}:${relativePath}`], { cwd: root, allowFailure: true });
      if (result.status !== 0) {
        throw configurationError('config/snapshot-missing', `配置快照中缺少 ${relativePath}，请将工作区入口与应用配置一并提交。`);
      }
      return result.stdout;
    },
  });
}

export function loadStagedWorkspace(root) {
  const result = runGit(['show', `:${CONFIG_FILE}`], { cwd: root, allowFailure: true });
  if (result.status === 0) return loadWorkspaceSnapshot(root, '');
  const history = runGit(['log', '-1', '--format=%H', '--', CONFIG_FILE], { cwd: root, allowFailure: true });
  if (history.status === 0 && history.stdout.trim()) {
    throw configurationError('config/staged-root-missing', `暂存区缺少已接入的 ${CONFIG_FILE}；不能使用未提交配置替代已删除的配置。`);
  }
  return loadWorkspace(root);
}
