import { createGateRegistry } from '../core/capability/gate-registry.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';
import { renderDynamicCodeResult } from './security/dynamic-code-renderer.js';
import { platformCapabilities } from './platform-capabilities.js';
import { nativePolicyGates } from './repository/native-policy-gates.js';
import { defineExternalGate } from './testing/external-gate.js';

const registeredDynamicCodeGate = Object.freeze({
  ...dynamicCodeGate,
  renderConsole: renderDynamicCodeResult,
});

export const officialGates = Object.freeze([
  registeredDynamicCodeGate,
  ...nativePolicyGates,
  ...platformCapabilities.filter((gate) => !nativePolicyGates.some(({ id }) => id === gate.id)),
]);

export const gateRegistry = createGateRegistry(officialGates);

export function createProjectGateRegistry(config) {
  return createGateRegistry([
    ...officialGates,
    ...config.externalGates.map(defineExternalGate),
  ]);
}
