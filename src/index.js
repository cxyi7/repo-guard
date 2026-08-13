export { loadConfig, matchRule, validateConfig } from './config.js';
export {
  createChangeSet,
  createGateContext,
  createStructuredLogger,
} from './core/capability/gate-context.js';
export { defineGate } from './core/capability/gate-definition.js';
export { createGateRegistry } from './core/capability/gate-registry.js';
export {
  createArtifact,
  createFinding,
  createGateResult,
  FINDING_SEVERITIES,
  gateResultToExitCode,
  GATE_STATUSES,
  gateStatusToExitCode,
} from './core/result/gate-result.js';
