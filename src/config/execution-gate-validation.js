import {
  DEFAULT_BUILD_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
} from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateExecutionGateConfiguration(value, configPath) {
  const buildValue = value.build ?? {};
  if (!buildValue || typeof buildValue !== 'object' || Array.isArray(buildValue)) {
    throw configValidationError(`${configPath} build must be an object`);
  }
  assertKnownProperties(
    buildValue,
    new Set(['enabled', 'script', 'timeoutMs']),
    `${configPath} build`,
  );
  if (buildValue.enabled != null && typeof buildValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} build.enabled must be a boolean`);
  }
  if (
    buildValue.script != null
    && (
      typeof buildValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(buildValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} build.script must be an npm script name`);
  }
  if (
    buildValue.timeoutMs != null
    && (!Number.isInteger(buildValue.timeoutMs) || buildValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} build.timeoutMs must be a positive integer`);
  }

  const lighthouseValue = value.lighthouse ?? {};
  if (!lighthouseValue || typeof lighthouseValue !== 'object' || Array.isArray(lighthouseValue)) {
    throw configValidationError(`${configPath} lighthouse must be an object`);
  }
  assertKnownProperties(
    lighthouseValue,
    new Set(['enabled', 'configFile', 'buildScript', 'timeoutMs']),
    `${configPath} lighthouse`,
  );
  if (lighthouseValue.enabled != null && typeof lighthouseValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} lighthouse.enabled must be a boolean`);
  }
  for (const field of ['configFile', 'buildScript']) {
    const fieldValue = lighthouseValue[field];
    if (
      fieldValue != null
      && (typeof fieldValue !== 'string' || !fieldValue.trim())
    ) {
      throw configValidationError(`${configPath} lighthouse.${field} must be null or a non-empty string`);
    }
  }
  if (
    typeof lighthouseValue.buildScript === 'string'
    && !/^[A-Za-z0-9:_-]+$/.test(lighthouseValue.buildScript.trim())
  ) {
    throw configValidationError(`${configPath} lighthouse.buildScript must be an npm script name`);
  }
  if (
    lighthouseValue.timeoutMs != null
    && (!Number.isInteger(lighthouseValue.timeoutMs) || lighthouseValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} lighthouse.timeoutMs must be a positive integer`);
  }

  const typeCheckValue = value.typeCheck ?? {};
  if (!typeCheckValue || typeof typeCheckValue !== 'object' || Array.isArray(typeCheckValue)) {
    throw configValidationError(`${configPath} typeCheck must be an object`);
  }
  assertKnownProperties(
    typeCheckValue,
    new Set(['enabled', 'script', 'timeoutMs']),
    `${configPath} typeCheck`,
  );
  if (typeCheckValue.enabled != null && typeof typeCheckValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} typeCheck.enabled must be a boolean`);
  }
  if (
    typeCheckValue.script != null
    && (
      typeof typeCheckValue.script !== 'string'
      || !/^[A-Za-z0-9:_-]+$/.test(typeCheckValue.script.trim())
    )
  ) {
    throw configValidationError(`${configPath} typeCheck.script must be an npm script name`);
  }
  if (
    typeCheckValue.timeoutMs != null
    && (!Number.isInteger(typeCheckValue.timeoutMs) || typeCheckValue.timeoutMs <= 0)
  ) {
    throw configValidationError(`${configPath} typeCheck.timeoutMs must be a positive integer`);
  }

  return {
    build: {
      enabled: buildValue.enabled ?? DEFAULT_BUILD_CONFIG.enabled,
      script: buildValue.script?.trim() || DEFAULT_BUILD_CONFIG.script,
      timeoutMs: buildValue.timeoutMs ?? DEFAULT_BUILD_CONFIG.timeoutMs,
    },
    lighthouse: {
      enabled: lighthouseValue.enabled ?? DEFAULT_LIGHTHOUSE_CONFIG.enabled,
      configFile: lighthouseValue.configFile?.trim() || DEFAULT_LIGHTHOUSE_CONFIG.configFile,
      buildScript: lighthouseValue.buildScript === null
        ? null
        : lighthouseValue.buildScript?.trim() || DEFAULT_LIGHTHOUSE_CONFIG.buildScript,
      timeoutMs: lighthouseValue.timeoutMs ?? DEFAULT_LIGHTHOUSE_CONFIG.timeoutMs,
    },
    typeCheck: {
      enabled: typeCheckValue.enabled ?? DEFAULT_TYPE_CHECK_CONFIG.enabled,
      script: typeCheckValue.script?.trim() || DEFAULT_TYPE_CHECK_CONFIG.script,
      timeoutMs: typeCheckValue.timeoutMs ?? DEFAULT_TYPE_CHECK_CONFIG.timeoutMs,
    },
  };
}
