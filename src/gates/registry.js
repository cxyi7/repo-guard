import { createGateRegistry } from '../core/capability/gate-registry.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';

export const gateRegistry = createGateRegistry([dynamicCodeGate]);
