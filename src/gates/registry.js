import { createGateRegistry } from '../core/capability/gate-registry.js';
import { vueAccessibilityGates } from './accessibility/vue-policy-gates.js';
import {
  architectureGate,
  buildGate,
  lighthouseGate,
  typecheckGate,
} from './quality/project-quality-gates.js';
import {
  eslintGate,
  prettierGate,
  styleComplexityGate,
  styleGovernanceGate,
  stylelintGate,
} from './quality/staged-quality-gates.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';
import { vueAsyncResourceCleanupGate } from './quality/vue-async-resource-cleanup-gate.js';
import { repositoryPolicyGates } from './repository/repository-policy-gates.js';
import { releaseReadinessGates } from './release/release-readiness-gates.js';
import { defineExternalGate } from './testing/external-gate.js';
import { accessibilityTestGate, unitTestGate } from './testing/platform-test-gates.js';
import { vueSecurityGates } from './security/vue-policy-gates.js';

const nativePolicyGates = Object.freeze([
  ...vueSecurityGates,
  ...vueAccessibilityGates,
  ...repositoryPolicyGates,
]);

const platformGates = Object.freeze([
  stylelintGate,
  eslintGate,
  prettierGate,
  typecheckGate,
  unitTestGate,
  accessibilityTestGate,
  architectureGate,
  buildGate,
  lighthouseGate,
  styleComplexityGate,
  styleGovernanceGate,
]);

export const officialGates = Object.freeze([
  vueAsyncResourceCleanupGate,
  dynamicCodeGate,
  ...nativePolicyGates,
  ...releaseReadinessGates,
  ...platformGates,
]);

export const gateRegistry = createGateRegistry(officialGates);

export function createProjectGateRegistry(config) {
  return createGateRegistry([
    ...officialGates,
    ...config.externalGates.map(defineExternalGate),
  ]);
}
