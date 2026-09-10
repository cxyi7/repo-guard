import { EXIT_CODES } from '../../core/result/exit-code.js';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { AGENT_POLICY_FILE, syncAgentPolicies } from '../../policies/agent-policies.js';
import { ensureProjectConfig } from './config-management.js';
import { installHooks } from './hook-installer.js';
import { syncDeliverySkills } from './delivery-skills.js';
import { workspaceAgentPolicyTargets } from '../workspace/targets.js';

export function runInit(cwd = process.cwd(), options = {}) {
  const root = findRepositoryRoot(cwd);
  const { created } = ensureProjectConfig(root, { project: options.project });
  const workspace = loadWorkspace(root);
  const result = installHooks({ cwd: root, updatePackageScripts: true });
  const agentPolicies = workspaceAgentPolicyTargets(workspace).map((target) => syncAgentPolicies(target.root, target.config));
  const agentPolicy = { changed: agentPolicies.some((policy) => policy.changed) };
  const deliverySkills = syncDeliverySkills(root, workspace.repositoryConfig.repository.deliveryContract.enabled);

  writeConsoleMessage(`repo-guard 已在以下目录完成初始化：${root}`);
  writeConsoleMessage(`- 配置：${CONFIG_FILE}${created ? '（已创建）' : '（已保留）'}`);
  writeConsoleMessage(`- Git Hook 路径：${result.hooksPath}`);
  writeConsoleMessage(`- 已安装的 Git Hook：${result.hooks.join(', ')}`);
  writeConsoleMessage(`- ${AGENT_POLICY_FILE}：${agentPolicy.changed ? '已同步' : '已是最新状态'}`);
  writeConsoleMessage(`- 交付流程 Skills：${deliverySkills.changed ? '已同步' : '已是最新状态'}`);
  for (const { project, relativeRoot } of workspace.projects) {
    writeConsoleMessage(`- 应用 ${project.id}：${project.role === 'backend' ? '后端' : '前端'}，预设 ${project.preset}，目录 ${relativeRoot}`);
  }
  writeConsoleMessage('- 已按显式预设生成基础检查配置；运行 repo-guard doctor 查看依赖与配置缺项。');
  writeConsoleMessage('- 检查工具使用项目安装的版本；本版本不会自动安装依赖或覆盖工具配置。');
  return EXIT_CODES.success;
}
