import path from 'node:path';
import { existsSync } from 'node:fs';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { createChangeSet, createGateContext } from '../../core/capability/gate-context.js';
import { REPOSITORY_GATE_IDS } from '../../gates/project-applicability.js';

export function selectProjects(workspace, projectId) {
  if (projectId === undefined) return workspace.projects;
  const selected = workspace.projects.find(({ id }) => id === projectId);
  if (!selected) throw configurationError('project/not-found', `未配置项目：${projectId}`);
  return [selected];
}

export function workspaceAgentPolicyTargets(workspace, projectId) {
  const projects = selectProjects(workspace, projectId);
  const rootApplication = workspace.projects.find((project) => project.root === workspace.root);
  return [
    {
      root: workspace.root,
      config: rootApplication?.config ?? workspace.repositoryConfig,
      label: rootApplication ? `应用 ${rootApplication.id}` : '仓库',
    },
    ...projects.filter((project) => project.root !== workspace.root)
      .map((project) => ({ ...project, label: `应用 ${project.id}` })),
  ];
}

export function relativeProjectPath(relativeRoot, filePath) {
  if (filePath == null) return null;
  const prefix = relativeRoot === '.' ? '' : `${relativeRoot.replace(/\/$/, '')}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null;
}

export function scopeProjectChanges(changes, relativeRoot) {
  return changes.flatMap((change) => {
    const current = relativeProjectPath(relativeRoot, change.path);
    const previous = relativeProjectPath(relativeRoot, change.oldPath);
    if (current == null && previous == null) return [];
    if (current == null) {
      return change.status.startsWith('R')
        ? [{ ...change, status: 'D', path: previous, oldPath: null }]
        : [];
    }
    if (change.oldPath != null && previous == null) {
      return [{ ...change, status: 'A', path: current, oldPath: null }];
    }
    return [{ ...change, path: current, oldPath: previous }];
  });
}

export function scopeProjectFiles(files, repositoryRoot, project) {
  return files.flatMap((file) => {
    const absolute = typeof file === 'string'
      ? path.resolve(repositoryRoot, file)
      : file.absolute ?? path.resolve(repositoryRoot, file.relative);
    const relative = path.relative(project.root, absolute).replaceAll('\\', '/');
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return [];
    return [{ relative, absolute }];
  });
}

export function createWorkspaceTargets({ workspace, environment, changes, files = [], projectId }) {
  const repository = createGateContext({
    root: workspace.root,
    repositoryRoot: workspace.root,
    environment,
    config: workspace.repositoryConfig,
    changes,
    files,
  });
  const projects = selectProjects(workspace, projectId).map((project) => createGateContext({
    root: project.root,
    repositoryRoot: workspace.root,
    project: project.project,
    environment,
    config: project.config,
    changes: createChangeSet({
      source: changes.source,
      revision: changes.revision,
      changes: scopeProjectChanges(changes.entries, project.relativeRoot),
    }),
    files: scopeProjectFiles(files, workspace.root, project),
  }));
  return { repository, projects };
}

export function workspaceStepTargets(targets, step) {
  if (step.gateId === 'dependencies.policy') {
    return targets.projects.some(({ root }) => root === targets.repository.root)
      || !existsSync(path.join(targets.repository.root, 'package.json'))
      ? targets.projects
      : [targets.repository, ...targets.projects];
  }
  return REPOSITORY_GATE_IDS.has(step.gateId) ? [targets.repository] : targets.projects;
}

export function projectStepLabel(context, step) {
  return context.project?.id ? `${context.project.id} / ${step.id}` : step.id;
}
