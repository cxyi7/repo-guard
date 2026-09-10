import { loadWorkspace } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';
import { hasHeadCommit, readOptionalSnapshotFile } from '../../git/snapshot-content.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { projectAffected } from './targets.js';
import { DELIVERY_CONFIG_FILE, validateDeliveryBinding } from '../../config/delivery-workspace.js';
import { normalizeRepositoryDocument } from '../../config/project-configuration.js';
import path from 'node:path';

export function loadWorkspaceSnapshot(root, revision, options = {}) {
  const engineering = readOptionalSnapshotFile(root, revision, CONFIG_FILE);
  if (engineering === null) {
    const binding = readOptionalSnapshotFile(root, revision, DELIVERY_CONFIG_FILE);
    if (binding !== null) {
      try {
        validateDeliveryBinding(JSON.parse(binding));
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
      const content = relativePath === CONFIG_FILE
        ? engineering
        : readOptionalSnapshotFile(root, revision, relativePath);
      if (content === null) {
        throw configurationError('config/snapshot-missing', `配置快照中缺少 ${relativePath}，请将工作区入口与应用配置一并提交。`);
      }
      return content;
    },
  });
}

export function loadStagedWorkspace(root) {
  const content = readOptionalSnapshotFile(root, '', CONFIG_FILE);
  if (content !== null) {
    const workspace = loadWorkspaceSnapshot(root, '', { lazyProjects: true });
    const changes = collectStagedChanges(root);
    workspace.projects.filter((project) => projectAffected(workspace, project, changes)).forEach((project) => project.config);
    return workspace;
  }
  const history = hasHeadCommit(root)
    ? runGit(['log', '-1', '--format=%H', '--', CONFIG_FILE], { cwd: root }).stdout.trim()
    : '';
  if (history) {
    throw configurationError('config/staged-root-missing', `暂存区缺少已接入的 ${CONFIG_FILE}；不能使用未提交配置替代已删除的配置。`);
  }
  const binding = readOptionalSnapshotFile(root, '', DELIVERY_CONFIG_FILE);
  if (binding !== null) return loadWorkspaceSnapshot(root, '', { lazyProjects: true });
  return loadWorkspace(root, { lazyProjects: true });
}
