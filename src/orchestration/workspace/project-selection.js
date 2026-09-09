import path from 'node:path';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { selectProjects } from './targets.js';

export function loadExecutionTarget(cwd = process.cwd(), { projectId, repositoryOnly = false } = {}) {
  const repositoryRoot = findRepositoryRoot(cwd);
  const workspace = loadWorkspace(repositoryRoot);
  if (projectId !== undefined) selectProjects(workspace, projectId);
  if (repositoryOnly) return { root: repositoryRoot, repositoryRoot, config: workspace.repositoryConfig };
  const candidates = projectId === undefined ? workspace.projects : selectProjects(workspace, projectId);
  const owned = candidates.filter(({ root }) => {
    const relative = path.relative(root, path.resolve(cwd));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  });
  const target = candidates.length === 1 ? candidates[0] : owned.length === 1 ? owned[0] : null;
  if (!target) {
    throw configurationError('project/selection-required', '当前仓库包含多个应用，请使用 --project <应用标识> 选择检查目标。');
  }
  return { ...target, repositoryRoot };
}
