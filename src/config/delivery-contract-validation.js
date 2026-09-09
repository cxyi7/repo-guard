import { DEFAULT_DELIVERY_CONTRACT_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizePatternList,
  normalizeRelativePattern,
} from './validation-primitives.js';

export function validateDeliveryContractConfiguration(value, configPath) {
  const candidate = value.deliveryContract ?? DEFAULT_DELIVERY_CONTRACT_CONFIG;
  const label = `${configPath} repository.deliveryContract`;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    candidate,
    new Set(['enabled', 'registryPath', 'contractsDirectory', 'requiredFor', 'exclude']),
    label,
  );
  if (candidate.enabled != null && typeof candidate.enabled !== 'boolean') {
    throw configValidationError(`${label}.enabled 必须是布尔值`);
  }

  const registryPath = normalizeRelativePattern(
    candidate.registryPath ?? DEFAULT_DELIVERY_CONTRACT_CONFIG.registryPath,
    `${label}.registryPath`,
  );
  if (!registryPath.endsWith('.json')) {
    throw configValidationError(`${label}.registryPath 必须指向 JSON 文件`);
  }
  const contractsDirectory = normalizeRelativePattern(
    candidate.contractsDirectory ?? DEFAULT_DELIVERY_CONTRACT_CONFIG.contractsDirectory,
    `${label}.contractsDirectory`,
  ).replace(/\/$/, '');
  if (!contractsDirectory || /\.[A-Za-z0-9]+$/.test(contractsDirectory)) {
    throw configValidationError(`${label}.contractsDirectory 必须指向仓库内目录`);
  }

  const requiredFor = normalizePatternList(
    candidate.requiredFor ?? DEFAULT_DELIVERY_CONTRACT_CONFIG.requiredFor,
    `${label}.requiredFor`,
    { allowEmpty: true },
  );
  const exclude = normalizePatternList(
    candidate.exclude ?? DEFAULT_DELIVERY_CONTRACT_CONFIG.exclude,
    `${label}.exclude`,
    { allowEmpty: true },
  );
  if (new Set(requiredFor).size !== requiredFor.length) {
    throw configValidationError(`${label}.requiredFor 不得包含重复值`);
  }
  if (new Set(exclude).size !== exclude.length) {
    throw configValidationError(`${label}.exclude 不得包含重复值`);
  }
  return {
    enabled: candidate.enabled ?? DEFAULT_DELIVERY_CONTRACT_CONFIG.enabled,
    registryPath,
    contractsDirectory,
    requiredFor,
    exclude,
  };
}
