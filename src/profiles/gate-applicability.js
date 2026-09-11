const FRONTEND_GATE_IDS = new Set([
  'quality.vue-async-resource-cleanup', 'quality.ui-tokens',
  'security.vue-unsafe-html', 'security.vue-target-blank',
  'accessibility.vue-form-label', 'accessibility.vue-image-alt',
  'quality.accessibility-test', 'quality.lighthouse',
]);

const NODE_GATE_IDS = new Set([
  ...FRONTEND_GATE_IDS,
  'quality.eslint', 'quality.prettier', 'quality.stylelint',
  'quality.style-complexity', 'quality.style-governance',
  'quality.typecheck', 'quality.dead-code', 'quality.unit-test',
  'quality.coverage', 'quality.mutation-test', 'quality.architecture',
  'quality.build', 'repository.unused-image-assets', 'dependencies.policy',
  'security.dynamic-code',
]);

export const JAVA_GATE_IDS = new Set([
  'java.format', 'java.naming', 'java.layout', 'java.imports', 'java.size',
  'java.docs', 'java.lint', 'java.duplication', 'java.architecture',
  'java.dependencies', 'java.files', 'java.compile', 'java.build',
  'java.test', 'java.coverage',
  'java.path-naming', 'java.spotbugs', 'java.mutation-test',
]);

/** 项目身份来自显式配置，工具安装不会改变检查适用范围。 */
export function gateAppliesToProject(gateId, project) {
  if (JAVA_GATE_IDS.has(gateId)) return project?.stack === 'java';
  if (project?.stack === 'java' && NODE_GATE_IDS.has(gateId)) return false;
  return project?.role !== 'backend' || !FRONTEND_GATE_IDS.has(gateId);
}
