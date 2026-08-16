import { loadConfig } from '../../config/configuration-loader.js';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  ARCHITECTURE_POLICY_FILE,
  ensureArchitecturePolicy,
  ensureAccessibilityTestPolicy,
  ensureExceptionPolicy,
  EXCEPTION_POLICY_FILE,
  ensureUnitTestPolicy,
  UNIT_TEST_POLICY_FILE,
} from '../../policies/managed-policies.js';
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
    if (created) {
      repairs.push('已创建 repo-guard.config.json');
      const config = loadConfig(root, { allowExpiredExceptions: true });
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `已更新 ${EXCEPTION_POLICY_FILE} 结构化例外策略`
          : `${EXCEPTION_POLICY_FILE} 结构化例外策略 已是最新状态`,
      );
    } else {
      const { changed, config } = migrateProjectConfig(root, {
        allowExpiredExceptions: true,
      });
      repairs.push(
        changed
          ? '已迁移 repo-guard.config.json'
          : 'repo-guard.config.json 已是最新状态',
      );
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `已更新 ${EXCEPTION_POLICY_FILE} 结构化例外策略`
          : `${EXCEPTION_POLICY_FILE} 结构化例外策略 已是最新状态`,
      );
      if (config.unitTest.enabled) {
        const policy = ensureUnitTestPolicy(root, config.unitTest);
        repairs.push(
          policy.changed
            ? `已更新 ${UNIT_TEST_POLICY_FILE} 单元测试策略`
            : `${UNIT_TEST_POLICY_FILE} 单元测试策略已是最新状态`,
        );
      }
      if (config.accessibilityTest.enabled) {
        const policy = ensureAccessibilityTestPolicy(root, config.accessibilityTest);
        repairs.push(
          policy.changed
            ? `已更新 ${ACCESSIBILITY_TEST_POLICY_FILE} 无障碍测试策略`
            : `${ACCESSIBILITY_TEST_POLICY_FILE} 无障碍测试策略已是最新状态`,
        );
      }
      if (config.architecture.enabled) {
        const policy = ensureArchitecturePolicy(root, config.architecture);
        repairs.push(
          policy.changed
            ? `已更新 ${ARCHITECTURE_POLICY_FILE} 架构策略`
            : `${ARCHITECTURE_POLICY_FILE} 架构策略已是最新状态`,
        );
      }
    }
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
