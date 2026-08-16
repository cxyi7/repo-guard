import { DEFAULT_DEPENDENCY_POLICY_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateDependencyPolicyConfiguration(value, configPath) {
  const dependencyPolicyValue = value.dependencyPolicy ?? {};
  if (!dependencyPolicyValue || typeof dependencyPolicyValue !== 'object'
    || Array.isArray(dependencyPolicyValue)) {
    throw configValidationError(`${configPath} dependencyPolicy 必须是对象`);
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
      throw configValidationError(`${configPath} dependencyPolicy.${property} 必须是布尔值`);
    }
  }
  const dependencyAllowedProtocolsValue = dependencyPolicyValue.allowedProtocols
    ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.allowedProtocols;
  if (!Array.isArray(dependencyAllowedProtocolsValue)) {
    throw configValidationError(`${configPath} dependencyPolicy.allowedProtocols 必须是数组`);
  }
  const dependencyAllowedProtocols = [...new Set(
    dependencyAllowedProtocolsValue.map((protocol, index) => {
      if (typeof protocol !== 'string'
        || !/^[a-z][a-z0-9+.-]*$/.test(protocol.trim().toLowerCase())) {
        throw configValidationError(
          `${configPath} dependencyPolicy.allowedProtocols 第 ${index + 1} `
          + '项必须是不含冒号的协议名称',
        );
      }
      return protocol.trim().toLowerCase();
    }),
  )];
  const bannedPackagesValue = dependencyPolicyValue.bannedPackages
    ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.bannedPackages;
  if (!Array.isArray(bannedPackagesValue)) {
    throw configValidationError(`${configPath} dependencyPolicy.bannedPackages 必须是数组`);
  }
  const bannedPackageNames = new Set();
  const dependencyBannedPackages = bannedPackagesValue.map((item, index) => {
    const label = `${configPath} dependencyPolicy.bannedPackages 第 ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(item, new Set(['name', 'reason', 'replacement']), label);
    if (typeof item.name !== 'string' || !item.name.trim()) {
      throw configValidationError(`${label}.name 必须是非空包名称`);
    }
    const name = item.name.trim();
    if (bannedPackageNames.has(name)) {
      throw configValidationError(`${configPath} 禁用包重复： ${name}`);
    }
    bannedPackageNames.add(name);
    if (typeof item.reason !== 'string' || item.reason.trim().length < 10) {
      throw configValidationError(`${label}.reason 必须至少包含 10 个字符`);
    }
    if (item.replacement != null
      && (typeof item.replacement !== 'string' || !item.replacement.trim())) {
      throw configValidationError(`${label}.replacement 必须为 null 或非空字符串`);
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
