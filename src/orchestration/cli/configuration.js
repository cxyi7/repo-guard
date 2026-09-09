import path from 'node:path';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { setFeaturesEnabled } from '../setup/config-management.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { syncAgentPolicies } from '../../policies/agent-policies.js';
import { syncDeliverySkills } from '../setup/delivery-skills.js';

function runFeatureToggle(requestedFeatures, enabled, cwd, options) {
  const root = findRepositoryRoot(cwd);
  const result = setFeaturesEnabled(root, requestedFeatures, enabled, options);
  const workspace = loadWorkspace(root);
  const config = workspace.repositoryConfig;
  const policies = workspace.projects.map((application) => syncAgentPolicies(application.root, application.config));
  if (!workspace.projects.some((application) => application.root === root)) policies.push(syncAgentPolicies(root, config));
  const agentPolicy = { changed: policies.some((policy) => policy.changed) };
  const deliverySkills = syncDeliverySkills(root, config.repository.deliveryContract.enabled);
  writeConsoleMessage(
    `repo-guard 托管规范文件 AGENTS.md：${agentPolicy.changed ? '已同步' : '已是最新状态'}`,
  );
  writeConsoleMessage(
    `repo-guard 交付流程 Skills：${deliverySkills.changed ? '已同步' : '已是最新状态'}`,
  );
  const state = enabled ? '已启用' : '已禁用';
  writeConsoleMessage(`repo-guard 功能： ${path.join(root, CONFIG_FILE)}`);
  for (const feature of result.changed) {
    writeConsoleMessage(`- ${feature}: ${state}`);
  }
  for (const feature of result.unchanged) {
    writeConsoleMessage(`- ${feature}：已经是 ${state}`);
  }
  writeConsoleMessage('- 运行 "repo-guard doctor" 校验项目依赖和配置');
  return 0;
}

export function runEnable(requestedFeatures, cwd = process.cwd(), options = {}) {
  return runFeatureToggle(requestedFeatures, true, cwd, options);
}

export function runDisable(requestedFeatures, cwd = process.cwd(), options = {}) {
  return runFeatureToggle(requestedFeatures, false, cwd, options);
}
