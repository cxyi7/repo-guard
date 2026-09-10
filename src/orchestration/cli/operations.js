import { EXIT_CODES } from '../../core/result/exit-code.js';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { loadOperationsConfig } from '../../operations/config/configuration.js';
import { installOperationsGitLabPipeline } from '../../operations/gitlab/installation.js';
import { renderOperationsGitLabPipeline } from '../../operations/gitlab/renderer.js';

export function runOperations(command, cwd = process.cwd(), { dryRun = false } = {}) {
  if (!['plan', 'install'].includes(command)) {
    throw configurationError('operations/invalid-command', '运维入口支持 repo-guard ops plan 或 repo-guard ops install');
  }
  const root = findRepositoryRoot(cwd);
  const workspace = loadWorkspace(root);
  const operations = loadOperationsConfig(root);
  if (operations.enabled && !workspace.repositoryConfig.ci.enabled) {
    throw configurationError(
      'operations/quality-ci-disabled',
      '独立运维发布要求先启用质量 CI；当前 ci.enabled 为 false。',
      {
        remediation: {
          goal: '在生成发布流水线前启用团队质量检查。',
          steps: ['运行 repo-guard enable ci，启用质量检查。', '确认团队的检查配置有效。'],
          constraints: ['不得通过跳过质量检查继续发布。'],
          verification: ['重新运行 repo-guard ops plan。'],
        },
      },
    );
  }
  const projects = workspace.projects.map(({ id, relativeRoot, project }) => ({ id, root: relativeRoot, stack: project.stack }));
  const preview = command === 'plan' || dryRun;
  const result = installOperationsGitLabPipeline(root, operations, projects, { dryRun: preview });
  if (!result.enabled) {
    writeConsoleMessage('运维发布未启用。请在独立的 repo-guard.ops.json 中声明应用、构建产物与部署脚本。');
    return EXIT_CODES.success;
  }
  writeConsoleMessage(preview ? '运维流水线预览：' : '运维流水线文件已生成；各应用独立构建和发布。');
  if (preview) writeConsoleMessage(renderOperationsGitLabPipeline(result.plan));
  if (!result.integrated) {
    writeConsoleMessage(result.guidance);
    writeConsoleMessage(result.manualSnippet);
  }
  return EXIT_CODES.success;
}
