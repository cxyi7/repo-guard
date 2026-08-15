import { DEFAULT_DEPENDENCY_POLICY_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateDependencyPolicyConfiguration(value, configPath) {
  const dependencyPolicyValue = value.dependencyPolicy ?? {};
  if (!dependencyPolicyValue || typeof dependencyPolicyValue !== 'object'
    || Array.isArray(dependencyPolicyValue)) {
    throw configValidationError(`${configPath} dependencyPolicy must be an object`);
  }
  assertKnownProperties(
    dependencyPolicyValue,
    new Set([
      'requireExactVersions',
      'requireLockfile',
      'enabled',
      'allowedProtocols',
      'bannedPackages',
    ]),
    `${configPath} dependencyPolicy`,
  );
  for (const property of ['enabled', 'requireExactVersions', 'requireLockfile']) {
    if (dependencyPolicyValue[property] != null
      && typeof dependencyPolicyValue[property] !== 'boolean') {
      throw configValidationError(`${configPath} dependencyPolicy.${property} must be a boolean`);
    }
  }
  const dependencyAllowedProtocolsValue = dependencyPolicyValue.allowedProtocols
    ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.allowedProtocols;
  if (!Array.isArray(dependencyAllowedProtocolsValue)) {
    throw configValidationError(`${configPath} dependencyPolicy.allowedProtocols must be an array`);
  }
  const dependencyAllowedProtocols = [...new Set(
    dependencyAllowedProtocolsValue.map((protocol, index) => {
      if (typeof protocol !== 'string'
        || !/^[a-z][a-z0-9+.-]*$/.test(protocol.trim().toLowerCase())) {
        throw configValidationError(
          `${configPath} dependencyPolicy.allowedProtocols item ${index + 1} `
          + 'must be a protocol name without a colon',
        );
      }
      return protocol.trim().toLowerCase();
    }),
  )];
  const bannedPackagesValue = dependencyPolicyValue.bannedPackages
    ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.bannedPackages;
  if (!Array.isArray(bannedPackagesValue)) {
    throw configValidationError(`${configPath} dependencyPolicy.bannedPackages must be an array`);
  }
  const bannedPackageNames = new Set();
  const dependencyBannedPackages = bannedPackagesValue.map((item, index) => {
    const label = `${configPath} dependencyPolicy.bannedPackages item ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw configValidationError(`${label} must be an object`);
    }
    assertKnownProperties(item, new Set(['name', 'reason', 'replacement']), label);
    if (typeof item.name !== 'string' || !item.name.trim()) {
      throw configValidationError(`${label}.name must be a non-empty package name`);
    }
    const name = item.name.trim();
    if (bannedPackageNames.has(name)) {
      throw configValidationError(`${configPath} banned package is duplicated: ${name}`);
    }
    bannedPackageNames.add(name);
    if (typeof item.reason !== 'string' || item.reason.trim().length < 10) {
      throw configValidationError(`${label}.reason must contain at least 10 characters`);
    }
    if (item.replacement != null
      && (typeof item.replacement !== 'string' || !item.replacement.trim())) {
      throw configValidationError(`${label}.replacement must be null or a non-empty string`);
    }
    return {
      name,
      reason: item.reason.trim(),
      replacement: item.replacement?.trim() ?? null,
    };
  });

  return {
    enabled: dependencyPolicyValue.enabled
      ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.enabled,
    requireExactVersions: dependencyPolicyValue.requireExactVersions
      ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.requireExactVersions,
    requireLockfile: dependencyPolicyValue.requireLockfile
      ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.requireLockfile,
    allowedProtocols: dependencyAllowedProtocols,
    bannedPackages: dependencyBannedPackages,
  };
}
