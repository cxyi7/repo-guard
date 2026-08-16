import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateRootConfigurationContract(value, configPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError(`${configPath} 必须包含 JSON 对象`);
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
    throw configValidationError(`${configPath} 使用了不支持的版本： ${String(value.version)}`);
  }
}
