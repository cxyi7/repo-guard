import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { createChangeSet, createGateContext } from '../../core/capability/gate-context.js';
import { REPOSITORY_GATE_IDS, SHARED_AND_APPLICATION_GATE_IDS } from '../../gates/project-applicability.js';

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

export function projectConfigurationChanged(workspace, project, changes) {
  const configurationPaths = new Set([workspace.configPath, project.configPath]
    .filter(Boolean).map((file) => path.relative(workspace.root, file).replaceAll('\\', '/')));
  return changes.some(({ path: current, oldPath }) => (
    configurationPaths.has(current) || configurationPaths.has(oldPath)
  ));
}

/** 仓库保护只处理应用之外的文件；根应用仍保留最小共享基础设施保护。 */
export function scopeRepositoryProtectionChanges(workspace, changes) {
  if (!workspace.document.projects) return changes;
  const infrastructure = new Set(['repo-guard.config.json', 'repo-guard.delivery.json', 'repo-guard.ops.json',
    'AGENTS.md', '.gitignore', '.gitattributes', '.gitlab-ci.yml', '.repo-guard/managed-skills.json',
    ...workspace.projects.map(({ configPath }) => path.relative(workspace.root, configPath).replaceAll('\\', '/'))]);
  const prefixes = ['.githooks/', '.github/workflows/', '.agents/skills/'];
  const rootApplication = workspace.projects.some(({ relativeRoot }) => relativeRoot === '.');
  const ownedByRepository = (file) => file != null && (
    rootApplication ? infrastructure.has(file) || prefixes.some((prefix) => file.startsWith(prefix))
      : !workspace.projects.some(({ relativeRoot }) => relativeProjectPath(relativeRoot, file) != null));
  return changes.flatMap((change) => {
    const current = ownedByRepository(change.path);
    const previous = ownedByRepository(change.oldPath);
    if (!current && !previous) return [];
    if (!current) return change.status.startsWith('R') ? [{ ...change, status: 'D', path: change.oldPath, oldPath: null }] : [];
    return change.oldPath != null && !previous ? [{ ...change, status: 'A', oldPath: null }] : [change];
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
  const selected = selectProjects(workspace, projectId);
  const affectedOnly = ['pre-commit', 'pre-push'].includes(environment);
  const projects = selected.filter((project) => !affectedOnly || projectAffected(workspace, project, changes.entries)).map((project) => createGateContext({
    root: project.root,
    repositoryRoot: workspace.root,
    project: project.project,
    environment,
    config: project.config,
    configurationChanged: projectConfigurationChanged(workspace, project, changes.entries),
    changes: createChangeSet({
      source: changes.source,
      revision: changes.revision,
      changes: scopeProjectChanges(changes.entries, project.relativeRoot),
    }),
    files: scopeProjectFiles(files, workspace.root, project),
  }));
  const repositoryProtection = createGateContext({ ...repository,
    changes: createChangeSet({ ...changes, changes: scopeRepositoryProtectionChanges(workspace, changes.entries) }),
  });
  return { repository, repositoryProtection, projects };
}

export function workspaceStepTargets(targets, step) {
  if (SHARED_AND_APPLICATION_GATE_IDS.has(step.gateId)) {
    if (step.gateId === 'repository.protected-files') return [...targets.projects, targets.repositoryProtection ?? targets.repository];
    return step.gateId === 'repository.agent-policy' && targets.projects.some(({ root }) => root === targets.repository.root)
      ? targets.projects
      : [...targets.projects, targets.repository];
  }
  return REPOSITORY_GATE_IDS.has(step.gateId) ? [targets.repository] : targets.projects;
}

export function projectAffected(workspace, project, changes) {
  if (changes.some(({ path: file, oldPath }) => [file, oldPath].includes('repo-guard.config.json'))) return true;
  if (scopeProjectChanges(changes, project.relativeRoot).length > 0) return true;
  return (workspace.document.sharedPaths ?? []).some((entry) => entry.projects.includes(project.id)
    && changes.some(({ path: file, oldPath }) => [file, oldPath].filter(Boolean)
      .some((value) => value === entry.path || value.startsWith(`${entry.path}/`))));
}

export function projectStepLabel(context, step) {
  return context.project?.id ? `${context.project.id} / ${step.id}` : step.id;
}
