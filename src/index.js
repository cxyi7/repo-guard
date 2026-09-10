export { loadConfig, loadWorkspace } from './config/configuration-loader.js';
export {
  normalizeProjectDocument as validateConfig,
  normalizeProjectDocument,
  createProjectDocument,
  serializeProjectConfig,
} from './config/project-configuration.js';
export { getProjectToolRequirements, PROJECT_PROFILES } from './profiles/project-profiles.js';
export { matchRule } from './config/path-matching.js';
export { EXIT_CODES, aggregateExitCodes, aggregateGateResults } from './core/result/exit-code.js';
export {
  createChangeSet,
  createGateContext,
  createStructuredLogger,
} from './core/capability/gate-context.js';
export { defineGate } from './core/capability/gate-definition.js';
export { createGateRegistry } from './core/capability/gate-registry.js';
export {
  cancellationError,
  configurationError,
  errorStatus,
  executionError,
  internalError,
  isRepoGuardError,
  rangeError,
  RepoGuardError,
  securityError,
  toRepoGuardError,
} from './core/error/repo-guard-error.js';
export {
  createArtifact,
  createFinding,
  createGateResult,
  FINDING_SEVERITIES,
  gateResultToExitCode,
  GATE_STATUSES,
  gateStatusToExitCode,
} from './core/result/gate-result.js';
