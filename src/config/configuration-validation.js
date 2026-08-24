import { toRepoGuardError } from '../core/error/repo-guard-error.js';
import { validateAccessibilityConfiguration } from './accessibility-validation.js';
import { validateArchitectureConfiguration } from './architecture-validation.js';
import { validateCiConfiguration } from './ci-validation.js';
import { validateCodePlacementConfiguration } from './code-placement-validation.js';
import { validateDependencyPolicyConfiguration } from './dependency-policy-validation.js';
import { validateDeadCodeConfiguration } from './dead-code-validation.js';
import { validateExceptionConfiguration } from './exception-validation.js';
import { validateExecutionGateConfiguration } from './execution-gate-validation.js';
import { validateNotificationConfiguration } from './notification-validation.js';
import { validateMutationTestConfiguration } from './mutation-test-validation.js';
import { validatePreCommitConfiguration } from './pre-commit-validation.js';
import {
  normalizeProtectedFileConfiguration,
  validateProtectedFileConfigurationShape,
} from './protected-file-validation.js';
import { validateRootConfigurationContract } from './root-configuration-validation.js';
import { validateUnitTestConfiguration } from './unit-test-validation.js';
import { CONFIG_FILE } from './validation-primitives.js';

export function validateConfigValue(value, configPath = CONFIG_FILE) {
  validateRootConfigurationContract(value, configPath);
  validateProtectedFileConfigurationShape(value, configPath);

  const notification = validateNotificationConfiguration(value, configPath);

  const { ci, externalGates } = validateCiConfiguration(value, configPath);

  const codePlacement = validateCodePlacementConfiguration(value, configPath);

  const exceptions = validateExceptionConfiguration(value, configPath);

  const dependencyPolicy = validateDependencyPolicyConfiguration(value, configPath);

  const deadCode = validateDeadCodeConfiguration(value, configPath);

  const architecture = validateArchitectureConfiguration(value, configPath);

  const { build, lighthouse, typeCheck } = validateExecutionGateConfiguration(
    value,
    configPath,
  );

  const accessibilityTest = validateAccessibilityConfiguration(value, configPath);

  const unitTest = validateUnitTestConfiguration(value, configPath);

  const mutationTest = validateMutationTestConfiguration(value, configPath);

  const preCommit = validatePreCommitConfiguration(value, configPath);

  const { rules, exclusions } = normalizeProtectedFileConfiguration(value, configPath);

  return {
    version: 1,
    notification,
    ci,
    externalGates,
    codePlacement,
    exceptions,
    dependencyPolicy,
    deadCode,
    architecture,
    build,
    lighthouse,
    typeCheck,
    accessibilityTest,
    unitTest,
    mutationTest,
    preCommit,
    rules,
    exclusions,
  };
}

export function validateConfig(value, configPath = CONFIG_FILE) {
  try {
    return validateConfigValue(value, configPath);
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'configuration',
      code: 'config/invalid',
      expected: `${configPath} 必须符合 repo-guard 支持的配置契约。`,
      remediation: {
        goal: `修正 ${configPath}，且不得削弱已启用的门禁或策略。`,
        steps: ['根据报告中的字段路径和校验消息修正无效值。'],
        constraints: ['不得仅为绕过配置校验而禁用门禁。'],
        verification: ['更新配置后运行 npm run guard:check。'],
      },
    });
  }
}
