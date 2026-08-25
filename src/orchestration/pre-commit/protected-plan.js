import {
  defineExecutionPlan,
  validateExecutionPlan,
} from '../../core/capability/execution-plan.js';
import { gateRegistry } from '../../gates/registry.js';
import { internalError } from '../../core/error/repo-guard-error.js';

export const PROTECTED_PRE_COMMIT_STEPS = Object.freeze([
  Object.freeze({ id: 'quality.stylelint-fix', gateId: 'quality.stylelint', mutation: 'working-tree-fix' }),
  Object.freeze({ id: 'quality.eslint-fix', gateId: 'quality.eslint', mutation: 'working-tree-fix' }),
  Object.freeze({ id: 'quality.prettier', gateId: 'quality.prettier', mutation: 'working-tree-fix' }),
  Object.freeze({ id: 'quality.stylelint-verify', gateId: 'quality.stylelint', mutation: 'read-only' }),
  Object.freeze({ id: 'quality.eslint-verify', gateId: 'quality.eslint', mutation: 'read-only' }),
  Object.freeze({ id: 'quality.vue-async-resource-cleanup', gateId: 'quality.vue-async-resource-cleanup', mutation: 'read-only' }),
  Object.freeze({ id: 'repository.path-naming', gateId: 'repository.path-naming', mutation: 'read-only' }),
  Object.freeze({ id: 'security.dynamic-code', gateId: 'security.dynamic-code', mutation: 'read-only' }),
  Object.freeze({ id: 'security.vue-unsafe-html', gateId: 'security.vue-unsafe-html', mutation: 'read-only' }),
  Object.freeze({ id: 'security.vue-target-blank', gateId: 'security.vue-target-blank', mutation: 'read-only' }),
  Object.freeze({ id: 'accessibility.vue-form-label', gateId: 'accessibility.vue-form-label', mutation: 'read-only' }),
  Object.freeze({ id: 'accessibility.vue-image-alt', gateId: 'accessibility.vue-image-alt', mutation: 'read-only' }),
  Object.freeze({ id: 'repository.maximum-file-lines', gateId: 'repository.maximum-file-lines', mutation: 'read-only' }),
  Object.freeze({ id: 'repository.file-placement', gateId: 'repository.file-placement', mutation: 'read-only' }),
  Object.freeze({ id: 'dependencies.policy', gateId: 'dependencies.policy', mutation: 'read-only' }),
  Object.freeze({ id: 'repository.image-assets', gateId: 'repository.image-assets', mutation: 'read-only' }),
  Object.freeze({ id: 'repository.code-placement', gateId: 'repository.code-placement', mutation: 'read-only' }),
  Object.freeze({ id: 'repository.protected-files', gateId: 'repository.protected-files', mutation: 'external-write' }),
]);

export const FORBIDDEN_PRE_COMMIT_GATE_IDS = Object.freeze([
  'quality.typecheck',
  'quality.unit-test',
  'quality.accessibility-test',
  'quality.architecture',
  'quality.build',
  'quality.lighthouse',
]);

const QUALITY_STEP_COUNT = PROTECTED_PRE_COMMIT_STEPS.findIndex(
  ({ id }) => id === 'dependencies.policy',
);

function sameStep(actual, expected) {
  return actual.id === expected.id
    && actual.gateId === expected.gateId
    && actual.mutation === expected.mutation;
}

export function validateProtectedPreCommitPlan(plan, registry = gateRegistry) {
  if (plan.id !== 'pre-commit' || plan.environment !== 'pre-commit' || !plan.locked) {
    throw internalError('pre-commit/invalid-protected-plan', '受保护的 pre-commit 计划必须锁定到 pre-commit 生命周期');
  }
  const forbidden = plan.steps.find(({ gateId }) => FORBIDDEN_PRE_COMMIT_GATE_IDS.includes(gateId));
  if (forbidden) {
    throw internalError('pre-commit/invalid-protected-plan', `受保护的 pre-commit 计划禁止项目级、类型检查、测试、构建和网络门禁：${forbidden.gateId}`);
  }
  if (plan.steps.length !== PROTECTED_PRE_COMMIT_STEPS.length
    || plan.steps.some((step, index) => !sameStep(step, PROTECTED_PRE_COMMIT_STEPS[index]))) {
    throw internalError('pre-commit/invalid-protected-plan', '不得更改受保护的 pre-commit 计划顺序和变更契约');
  }
  return validateExecutionPlan(plan, registry);
}

export function defineProtectedPreCommitPlan({ steps = PROTECTED_PRE_COMMIT_STEPS } = {}) {
  return validateProtectedPreCommitPlan(defineExecutionPlan({
    id: 'pre-commit',
    environment: 'pre-commit',
    locked: true,
    steps,
  }));
}

export const preCommitPlan = defineProtectedPreCommitPlan();

function section(id, steps) {
  return Object.freeze({
    id,
    environment: preCommitPlan.environment,
    locked: true,
    steps: Object.freeze([...steps]),
  });
}

export const preCommitQualityPlan = section(
  'pre-commit:staged-quality',
  preCommitPlan.steps.slice(0, QUALITY_STEP_COUNT),
);

export const preCommitPolicyPlan = section(
  'pre-commit:final-policy',
  preCommitPlan.steps.slice(QUALITY_STEP_COUNT),
);
