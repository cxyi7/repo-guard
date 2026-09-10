import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { AGENT_POLICY_FILE, syncAgentPolicies } from '../../policies/agent-policies.js';
import { assertHookInstallationSupported, installHooks } from './hook-installer.js';
import { syncDeliverySkills } from './delivery-skills.js';
import { workspaceAgentPolicyTargets } from '../workspace/targets.js';
import { assertManagedDocumentFormats } from './managed-format-preflight.js';
import { DELIVERY_CONFIG_FILE } from '../../config/delivery-workspace.js';

export function repairRepository(root, { projectId } = {}) {
  const repairs = [];
  const repairErrors = [];

  try {
    if (!existsSync(path.join(root, 'repo-guard.config.json')) && !existsSync(path.join(root, DELIVERY_CONFIG_FILE))) {
      throw configurationError('doctor/missing-project-config', '缺少 repo-guard.config.json；请使用 repo-guard init --role <frontend|backend> --stack node --preset <预设> --project <标识> 显式声明项目，不会通过 doctor --fix 猜测身份。');
    }
    const workspace = loadWorkspace(root, { allowExpiredExceptions: true, lazyProjects: true });
    const config = workspace.repositoryConfig;
    const targets = workspaceAgentPolicyTargets(workspace, projectId);
    assertManagedDocumentFormats(root, { workspace, projectId });
    assertHookInstallationSupported(root);
    for (const target of targets) {
      const agentPolicy = syncAgentPolicies(target.root, target.config);
      repairs.push(agentPolicy.changed
        ? `已同步${target.label} ${AGENT_POLICY_FILE} 托管规范`
        : `${target.label} ${AGENT_POLICY_FILE} 托管规范已是最新状态`);
    }
    const deliverySkills = syncDeliverySkills(root, config.repository.deliveryContract.enabled);
    repairs.push(
      deliverySkills.changed
        ? '已同步交付流程 Skills'
        : '交付流程 Skills 已是最新状态',
    );
  } catch (error) {
    repairErrors.push(`配置修复失败：${error.message}`);
    return { repairErrors, repairs };
  }

  try {
    installHooks({ cwd: root, updatePackageScripts: existsSync(path.join(root, 'repo-guard.config.json')), projectId });
    repairs.push('已协调托管 Hook、仓库文件和 package 脚本');
  } catch (error) {
    repairErrors.push(`安装修复失败：${error.message}`);
  }

  return { repairErrors, repairs };
}
