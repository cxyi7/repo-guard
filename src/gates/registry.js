import { createGateRegistry } from '../core/capability/gate-registry.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';
import { platformCapabilities } from './platform-capabilities.js';
import { nativePolicyGates } from './repository/native-policy-gates.js';
import { releaseReadinessGates } from './release/release-readiness-gates.js';
import { defineExternalGate } from './testing/external-gate.js';

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
