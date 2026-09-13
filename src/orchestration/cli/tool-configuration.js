import { loadWorkspace } from '../../config/configuration-loader.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { selectProjects } from '../workspace/targets.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { EXIT_CODES } from '../../core/result/exit-code.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { sanitizeProcessOutput } from '../../core/execution/output-safety.js';
import { inspectFrontendToolConfiguration } from '../../gates/quality/tool-configuration.js';

export async function runToolConfiguration({ tool, file, projectId, cwd = process.cwd() }) {
  const workspace = loadWorkspace(findRepositoryRoot(cwd), { lazyProjects: true });
  const projects = selectProjects(workspace, projectId);
  if (projects.length !== 1) throw configurationError('tool-config/project-required', '多应用配置查询必须通过 --project 选择一个应用。');
  const project = projects[0];
  const report = await inspectFrontendToolConfiguration({ root: project.root, config: project.config, tool, file });
  writeConsoleMessage(sanitizeProcessOutput(JSON.stringify(report, null, 2), { root: project.root }).text);
  return EXIT_CODES.success;
}
