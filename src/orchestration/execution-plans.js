import {
  createExecutionPlanRegistry,
  defineExecutionPlan,
  validateExecutionPlan,
} from '../core/capability/execution-plan.js';
import { gateRegistry } from '../gates/registry.js';
import { preCommitPlan } from './pre-commit/protected-plan.js';

export { preCommitPlan } from './pre-commit/protected-plan.js';

export const prePushPlan = defineExecutionPlan({
  id: 'pre-push',
  environment: 'pre-push',
  locked: true,
  steps: [
    'repository.commit-message',
    'quality.typecheck',
    'quality.dead-code',
    'repository.unused-image-assets',
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
    'repository.agent-policy',
    'repository.commit-message',
    { id: 'quality.vue-async-resource-cleanup', gateId: 'quality.vue-async-resource-cleanup', reportName: 'async-resource-cleanup' },
    { id: 'repository.path-naming', gateId: 'repository.path-naming', reportName: 'path-naming' },
    { id: 'security.dynamic-code', gateId: 'security.dynamic-code', reportName: 'dynamic-code' },
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
    'dependencies.policy',
    'repository.file-placement',
    'repository.image-assets',
    'repository.code-placement',
    'repository.maximum-file-lines',
    {
      id: 'quality.unit-test-policy',
      gateId: 'quality.unit-test',
      reportName: 'unit-test-policy',
    },
    {
      id: 'repository.protected-files',
      gateId: 'repository.protected-files',
      mutation: 'read-only',
      reportName: 'protected-files',
    },
  ],
});

export const ciFullPlan = defineExecutionPlan({
  id: 'ci-full',
  environment: 'ci-full',
  locked: true,
  steps: [
    'repository.structured-exceptions',
    'repository.agent-policy',
    'repository.commit-message',
    { id: 'quality.vue-async-resource-cleanup', gateId: 'quality.vue-async-resource-cleanup', reportName: 'async-resource-cleanup' },
    { id: 'repository.path-naming', gateId: 'repository.path-naming', reportName: 'path-naming' },
    { id: 'security.dynamic-code', gateId: 'security.dynamic-code', reportName: 'dynamic-code' },
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
    'dependencies.policy',
    'repository.file-placement',
    'repository.image-assets',
    'repository.code-placement',
    'repository.maximum-file-lines',
    {
      id: 'quality.unit-test-policy',
      gateId: 'quality.unit-test',
      reportName: 'unit-test-policy',
    },
    {
      id: 'repository.protected-files',
      gateId: 'repository.protected-files',
      mutation: 'read-only',
      reportName: 'protected-files',
    },
    {
      id: 'quality.stylelint-project',
      gateId: 'quality.stylelint',
      mutation: 'read-only',
      reportName: 'stylelint',
    },
    {
      id: 'quality.eslint-project',
      gateId: 'quality.eslint',
      mutation: 'read-only',
      reportName: 'eslint',
    },
    {
      id: 'quality.prettier-project',
      gateId: 'quality.prettier',
      mutation: 'read-only',
      reportName: 'prettier',
    },
    { id: 'quality.typecheck', gateId: 'quality.typecheck', reportName: 'type-check' },
    { id: 'quality.dead-code', gateId: 'quality.dead-code', reportName: 'dead-code' },
    { id: 'repository.unused-image-assets', gateId: 'repository.unused-image-assets', reportName: 'unused-image-assets' },
    'quality.unit-test',
    'quality.accessibility-test',
    'quality.architecture',
    { id: 'quality.build', gateId: 'quality.build', reportName: 'build' },
  ],
});

export const releaseReadyPlan = defineExecutionPlan({
  id: 'release-ready',
  environment: 'release-ready',
  locked: true,
  steps: [
    ...ciPolicyPlan.steps,
    'repository.unused-image-assets',
    'release.check',
    'release.test',
    { id: 'quality.build', gateId: 'quality.build', reportName: 'build' },
    'quality.lighthouse',
    'release.package',
  ],
});

function includeExternalGate(config, gate, environment, includeExternalGates) {
  if (!includeExternalGates || !gate.environments.includes(environment)) return false;
  const mode = config.ci?.gatePolicy?.gates?.[gate.id]?.mode
    ?? config.ci?.gatePolicy?.defaultMode
    ?? 'inherit';
  return gate.enabled || mode !== 'inherit';
}

export function createProjectCiFullPlan(config, registry, { includeExternalGates = true } = {}) {
  return validateExecutionPlan(defineExecutionPlan({
    id: 'ci-full',
    environment: 'ci-full',
    locked: true,
    steps: [
      ...ciFullPlan.steps,
      ...config.externalGates
        .filter((gate) => includeExternalGate(
          config,
          gate,
          'ci-full',
          includeExternalGates,
        ))
        .map(({ id }) => id),
    ],
  }), registry);
}

export function createProjectReleaseReadyPlan(
  config,
  registry,
  { includeExternalGates = true } = {},
) {
  return validateExecutionPlan(defineExecutionPlan({
    id: 'release-ready',
    environment: 'release-ready',
    locked: true,
    steps: [
      ...releaseReadyPlan.steps,
      ...config.externalGates
        .filter((gate) => includeExternalGate(
          config,
          gate,
          'release-ready',
          includeExternalGates,
        ))
        .map(({ id }) => id),
    ],
  }), registry);
}

export const executionPlans = createExecutionPlanRegistry([
  preCommitPlan,
  prePushPlan,
  ciPolicyPlan,
  ciFullPlan,
  releaseReadyPlan,
], gateRegistry);
