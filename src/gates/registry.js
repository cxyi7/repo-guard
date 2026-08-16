import { createGateRegistry } from '../core/capability/gate-registry.js';
import { vueAccessibilityGates } from './accessibility/vue-policy-gates.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';
import { platformCapabilities } from './platform-capabilities.js';
import { repositoryPolicyGates } from './repository/repository-policy-gates.js';
import { releaseReadinessGates } from './release/release-readiness-gates.js';
import { defineExternalGate } from './testing/external-gate.js';
import { vueSecurityGates } from './security/vue-policy-gates.js';

const nativePolicyGates = Object.freeze([
  ...vueSecurityGates,
  ...vueAccessibilityGates,
  ...repositoryPolicyGates,
]);

export const officialGates = Object.freeze([
  dynamicCodeGate,
  ...nativePolicyGates,
  ...releaseReadinessGates,
  ...platformCapabilities.filter((gate) => !nativePolicyGates.some(({ id }) => id === gate.id)),
]);

export const gateRegistry = createGateRegistry(officialGates);

export function createProjectGateRegistry(config) {
  return createGateRegistry([
    ...officialGates,
    ...config.externalGates.map(defineExternalGate),
  ]);
}
