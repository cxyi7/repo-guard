const FRONTEND_GATE_IDS = new Set([
  'quality.vue-async-resource-cleanup',
  'quality.ui-tokens',
  'security.vue-unsafe-html',
  'security.vue-target-blank',
  'accessibility.vue-form-label',
  'accessibility.vue-image-alt',
  'quality.accessibility-test',
  'quality.lighthouse',
]);

// 项目身份来自显式配置。安装了其他框架的依赖不改变门禁适用范围。
export function gateAppliesToProject(gateId, project) {
  return project?.role !== 'backend' || !FRONTEND_GATE_IDS.has(gateId);
}

export const REPOSITORY_GATE_IDS = new Set([
  'repository.structured-exceptions',
  'repository.agent-policy',
  'repository.commit-message',
  'dependencies.policy',
  'repository.code-placement',
  'repository.delivery-contract',
  'repository.protected-files',
  'release.delivery-evidence',
]);
