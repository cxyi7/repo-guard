import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateRootConfigurationContract(value, configPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${configPath} must contain a JSON object`);
  }
  assertKnownProperties(
    value,
    new Set([
      '$schema',
      'version',
      'notification',
      'ci',
      'externalGates',
      'exceptions',
      'dependencyPolicy',
      'architecture',
      'accessibilityTest',
      'build',
      'lighthouse',
      'typeCheck',
      'unitTest',
      'preCommit',
      'rules',
      'exclusions',
    ]),
    configPath,
  );
  if (value.version !== 1) {
    throw configValidationError(`${configPath} uses unsupported version: ${String(value.version)}`);
  }
}
