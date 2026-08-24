import { findRepositoryRoot } from '../../git/repository.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { loadConfig } from '../../config/configuration-loader.js';
import { syncAgentPolicies } from '../../policies/agent-policies.js';
import {
  GITLAB_CI_FILE,
  GITLAB_TEMPLATE_FILE,
  installGitLabCi,
} from '../setup/gitlab-ci.js';

export function runInstallCiCommand(cwd = process.cwd(), {
  provider,
  profile,
  stage,
  dryRun,
} = {}) {
  if (provider !== 'gitlab') throw configurationError('install-ci/unsupported-provider', '仅支持 gitlab CI 提供方');
  const root = findRepositoryRoot(cwd);
  const result = installGitLabCi(root, { profile, stage, dryRun });
  if (!dryRun) syncAgentPolicies(root, loadConfig(root));
  writeConsoleMessage(`repo-guard GitLab CI 操作：${dryRun ? '预览' : '安装'}`);
  writeConsoleMessage(`- 模板：${GITLAB_TEMPLATE_FILE}（${result.templateChanged ? '已更新' : '当前版本'}）`);
  writeConsoleMessage(`- 配置档： ${result.profile}`);
  writeConsoleMessage(`- 应用交付：${result.pipelineEnabled ? '已托管' : '未启用'}`);
  if (result.integrated) {
    writeConsoleMessage(`- ${GITLAB_CI_FILE}：已集成到 stage ${result.stage}`);
  } else {
    writeConsoleMessage(`- ${GITLAB_CI_FILE}：未修改，原因：${result.conflict}`, 'stderr');
    writeConsoleMessage('请将以下已审查片段添加到现有 GitLab CI 配置中：', 'stderr');
    writeConsoleMessage(result.manualSnippet, 'stderr');
  }
  return 0;
}
