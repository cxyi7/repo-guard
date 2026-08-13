import {
  createExecutionPlanRegistry,
  defineExecutionPlan,
} from '../core/capability/execution-plan.js';
import { gateRegistry } from '../gates/registry.js';

export const preCommitPlan = defineExecutionPlan({
  id: 'pre-commit',
  environment: 'pre-commit',
  locked: true,
  steps: [
    { id: 'quality.stylelint-fix', gateId: 'quality.stylelint', mutation: 'working-tree-fix' },
    { id: 'quality.eslint-fix', gateId: 'quality.eslint', mutation: 'working-tree-fix' },
    'quality.prettier',
    { id: 'quality.stylelint-verify', gateId: 'quality.stylelint', mutation: 'read-only' },
    { id: 'quality.eslint-verify', gateId: 'quality.eslint', mutation: 'read-only' },
    'security.dynamic-code',
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
    'repository.maximum-file-lines',
    'repository.file-placement',
    'dependencies.policy',
    'repository.protected-files',
  ],
});

export const prePushPlan = defineExecutionPlan({
  id: 'pre-push',
  environment: 'pre-push',
  locked: true,
  steps: [
    'quality.typecheck',
    'quality.unit-test',
    'quality.accessibility-test',
    'quality.architecture',
    'quality.build',
    'quality.lighthouse',
  ],
});

export const ciPolicyPlan = defineExecutionPlan({
  id: 'ci-policy',
  environment: 'ci-policy',
  locked: true,
  steps: [
    'repository.structured-exceptions',
    'security.dynamic-code',
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
    'dependencies.policy',
    'repository.file-placement',
    'repository.maximum-file-lines',
    { id: 'quality.unit-test-policy', gateId: 'quality.unit-test' },
    { id: 'repository.protected-files', gateId: 'repository.protected-files', mutation: 'read-only' },
  ],
});

export const ciFullPlan = defineExecutionPlan({
  id: 'ci-full',
  environment: 'ci-full',
  locked: true,
  steps: [
    'repository.structured-exceptions',
    'security.dynamic-code',
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
    'dependencies.policy',
    'repository.file-placement',
    'repository.maximum-file-lines',
    { id: 'quality.unit-test-policy', gateId: 'quality.unit-test' },
    { id: 'repository.protected-files', gateId: 'repository.protected-files', mutation: 'read-only' },
    { id: 'quality.stylelint-project', gateId: 'quality.stylelint', mutation: 'read-only' },
    { id: 'quality.eslint-project', gateId: 'quality.eslint', mutation: 'read-only' },
    { id: 'quality.prettier-project', gateId: 'quality.prettier', mutation: 'read-only' },
    'quality.typecheck',
    'quality.unit-test',
    'quality.accessibility-test',
    'quality.architecture',
    'quality.build',
  ],
});

export const executionPlans = createExecutionPlanRegistry([
  preCommitPlan,
  prePushPlan,
  ciPolicyPlan,
  ciFullPlan,
], gateRegistry);
