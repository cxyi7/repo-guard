import { configurationError } from '../core/error/repo-guard-error.js';
import { loadWorkspace } from './workspace-configuration.js';

export { loadWorkspace, readConfigurationDocument } from './workspace-configuration.js';

export function loadConfig(root, options = {}) {
  const workspace = loadWorkspace(root, options);
  if (options.repositoryOnly) return workspace.repositoryConfig;
  if (options.projectId !== undefined) {
    const project = workspace.projects.find((entry) => entry.id === options.projectId);
    if (!project) throw configurationError('project/not-found', `未配置项目：${options.projectId}。`);
    return project.config;
  }
  if (workspace.projects.length !== 1) {
    throw configurationError('project/selection-required', '当前仓库配置了多个应用；请使用 --project 显式选择应用，或通过工作区入口分别执行。');
  }
  return workspace.projects[0].config;
}
