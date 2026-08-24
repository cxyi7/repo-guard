import { loadConfig } from '../../config/configuration-loader.js';
import { AGENT_POLICY_FILE, syncAgentPolicies } from '../../policies/agent-policies.js';
import {
  ensureProjectConfig,
  migrateProjectConfig,
} from './config-management.js';
import { installHooks } from './hook-installer.js';

export function repairRepository(root) {
  const repairs = [];
  const repairErrors = [];

  try {
    const { created } = ensureProjectConfig(root);
    let config;
    if (created) {
      repairs.push('已创建 repo-guard.config.json');
      config = loadConfig(root, { allowExpiredExceptions: true });
    } else {
      const migration = migrateProjectConfig(root, { allowExpiredExceptions: true });
      config = migration.config;
      repairs.push(
        migration.changed
          ? '已迁移 repo-guard.config.json'
          : 'repo-guard.config.json 已是最新状态',
      );
    }

    const agentPolicy = syncAgentPolicies(root, config);
    repairs.push(
      agentPolicy.changed
        ? `已同步 ${AGENT_POLICY_FILE} 项目托管规范`
        : `${AGENT_POLICY_FILE} 项目托管规范已是最新状态`,
    );
  } catch (error) {
    repairErrors.push(`配置修复失败：${error.message}`);
  }

  try {
    installHooks({ cwd: root, updatePackageScripts: true });
    repairs.push('已协调托管 Hook、仓库文件和 package 脚本');
  } catch (error) {
    repairErrors.push(`安装修复失败：${error.message}`);
  }

  return { repairErrors, repairs };
}
