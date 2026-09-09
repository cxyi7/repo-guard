import { configurationError } from '../../core/error/repo-guard-error.js';
import { validateOperationsConfig, requireIdentifier, requireRelativePath } from '../config/validation.js';
import { nodeArtifactVerificationCommand, nodeReleaseCommand, validateNodeReleaseScripts } from '../providers/node.js';

function normalizedProjects(projects) {
  const list = Array.isArray(projects)
    ? projects : Object.entries(projects ?? {}).map(([id, project]) => ({ ...project, id }));
  const seen = new Set();
  return list.map((project) => {
    requireIdentifier(project.id, '项目标识');
    if (seen.has(project.id)) {
      throw configurationError('operations/duplicate-project', `项目标识重复：${project.id}`);
    }
    seen.add(project.id);
    return { ...project, root: requireRelativePath(project.root, `项目 ${project.id} 的目录`, { allowRoot: true }) };
  });
}

function projectPlan(repositoryRoot, id, unit, projects) {
  const project = projects.find((item) => item.id === id);
  if (!project) throw configurationError('operations/unknown-project', `运维配置引用了未声明的项目：${id}`);
  if (project.stack !== 'node') {
    throw configurationError('operations/unsupported-runtime', `项目 ${id} 的 ${project.stack} 运维适配尚未提供；当前仅支持显式声明 stack=node 的应用`);
  }
  validateNodeReleaseScripts(repositoryRoot, project, unit);
  const artifactPaths = unit.artifactPaths.map((artifact) => project.root === '.' ? artifact : `${project.root}/${artifact}`);
  return {
    projectId: id,
    root: project.root,
    runtime: 'node',
    quality: {
      job: `repo_guard_quality__${id}`,
      command: `npx --no-install repo-guard ci --project ${id} --profile ${unit.qualityProfile}`,
    },
    build: {
      job: `repo_guard_build__${id}`,
      command: nodeReleaseCommand(unit.buildScript),
      verifyArtifactsCommand: nodeArtifactVerificationCommand(unit.artifactPaths),
      artifactPaths,
      artifactName: `$CI_PROJECT_PATH_SLUG-${id}-$CI_COMMIT_SHA`,
    },
    deployments: Object.entries(unit.environments).map(([environmentId, environment]) => ({
      job: `repo_guard_deploy__${id}__${environmentId}`,
      command: nodeReleaseCommand(environment.script),
      environment: `${id}/${environmentId}`,
      resourceGroup: `${id}-${environmentId}`,
      production: environment.production,
      branches: environment.branches,
    })),
  };
}

export function planOperationsPipeline(repositoryRoot, operations, projectDeclarations = []) {
  const config = validateOperationsConfig(operations);
  if (!config.enabled) return { enabled: false, provider: config.provider, projects: [] };
  const projects = normalizedProjects(projectDeclarations);
  return {
    enabled: true,
    provider: config.provider,
    projects: Object.entries(config.projects).filter(([, unit]) => unit.enabled)
      .map(([id, unit]) => projectPlan(repositoryRoot, id, unit, projects)),
  };
}
