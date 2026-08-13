import { createGateRegistry } from '../core/capability/gate-registry.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';
import { renderDynamicCodeResult } from './security/dynamic-code-renderer.js';

const registeredDynamicCodeGate = Object.freeze({
  ...dynamicCodeGate,
  renderConsole: renderDynamicCodeResult,
});

export const gateRegistry = createGateRegistry([registeredDynamicCodeGate]);
