import { loadWorkspace } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { projectAffected } from './targets.js';
import { DELIVERY_CONFIG_FILE, validateDeliveryBinding } from '../../config/delivery-workspace.js';
import { normalizeRepositoryDocument } from '../../config/project-configuration.js';
import path from 'node:path';

export function loadWorkspaceSnapshot(root, revision, options = {}) {
  const engineering = runGit(['show', `${revision}:${CONFIG_FILE}`], { cwd: root, allowFailure: true });
  if (engineering.status !== 0) {
    const binding = runGit(['show', `${revision}:${DELIVERY_CONFIG_FILE}`], { cwd: root, allowFailure: true });
    if (binding.status === 0) {
      try {
        validateDeliveryBinding(JSON.parse(binding.stdout));
      } catch (error) {
        throw configurationError('config/delivery-snapshot-invalid', `交付配置快照无效：${error.message}`, { cause: error });
      }
      const document = { version: 2, projects: [], ci: { enabled: true } };
      return { root, configPath: path.join(root, CONFIG_FILE), document,
        repositoryConfig: normalizeRepositoryDocument(document), projects: [], deliveryOnly: true };
    }
  }
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
  if (result.status === 0) {
    const workspace = loadWorkspaceSnapshot(root, '', { lazyProjects: true });
    const changes = collectStagedChanges(root);
    workspace.projects.filter((project) => projectAffected(workspace, project, changes)).forEach((project) => project.config);
    return workspace;
  }
  const history = runGit(['log', '-1', '--format=%H', '--', CONFIG_FILE], { cwd: root, allowFailure: true });
  if (history.status === 0 && history.stdout.trim()) {
    throw configurationError('config/staged-root-missing', `暂存区缺少已接入的 ${CONFIG_FILE}；不能使用未提交配置替代已删除的配置。`);
  }
  const binding = runGit(['show', `:${DELIVERY_CONFIG_FILE}`], { cwd: root, allowFailure: true });
  if (binding.status === 0) return loadWorkspaceSnapshot(root, '', { lazyProjects: true });
  return loadWorkspace(root, { lazyProjects: true });
}
