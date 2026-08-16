import path from 'node:path';
import { loadConfig } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import {
  migrateProjectConfig,
  setFeaturesEnabled,
} from '../setup/config-management.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import {
  ensureAccessibilityTestPolicy,
  ensureArchitecturePolicy,
  ensureUnitTestPolicy,
} from '../../policies/managed-policies.js';

export function runMigrate(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const result = migrateProjectConfig(root);
  writeConsoleMessage(`repo-guard 配置： ${path.join(root, CONFIG_FILE)}`);
  writeConsoleMessage(`- 迁移：${result.changed ? '已更新' : '已是最新状态'}`);
  return 0;
}

function runFeatureToggle(requestedFeatures, enabled, cwd) {
  const root = findRepositoryRoot(cwd);
  const result = setFeaturesEnabled(root, requestedFeatures, enabled);
  if (enabled && requestedFeatures.includes('architecture')) {
    const policy = ensureArchitecturePolicy(root, loadConfig(root).architecture);
    writeConsoleMessage(
      `repo-guard 架构策略：${policy.changed ? '已更新' : '已是最新状态'}`,
    );
  }
  if (enabled && requestedFeatures.includes('accessibilityTest')) {
    const policy = ensureAccessibilityTestPolicy(
      root,
      loadConfig(root).accessibilityTest,
    );
    writeConsoleMessage(
      `repo-guard 无障碍测试策略：${policy.changed ? '已更新' : '已是最新状态'}`,
    );
  }
  if (enabled && requestedFeatures.some((feature) => (
    feature === 'unitTest' || feature === 'coverage' || feature === 'componentInteraction'
  ))) {
    const policy = ensureUnitTestPolicy(root, loadConfig(root).unitTest);
    writeConsoleMessage(
      `repo-guard 单元测试策略：${policy.changed ? '已更新' : '已是最新状态'}`,
    );
  }
  const state = enabled ? '已启用' : '已禁用';
  writeConsoleMessage(`repo-guard 功能： ${path.join(root, CONFIG_FILE)}`);
  if (result.migrated) {
    writeConsoleMessage('- 配置：已迁移');
  }
  for (const feature of result.changed) {
    writeConsoleMessage(`- ${feature}: ${state}`);
  }
  for (const feature of result.unchanged) {
    writeConsoleMessage(`- ${feature}：已经是 ${state}`);
  }
  writeConsoleMessage('- 运行 "repo-guard doctor" 校验项目依赖和配置');
  return 0;
}

export function runEnable(requestedFeatures, cwd = process.cwd()) {
  return runFeatureToggle(requestedFeatures, true, cwd);
}

export function runDisable(requestedFeatures, cwd = process.cwd()) {
  return runFeatureToggle(requestedFeatures, false, cwd);
}
