import { toRepoGuardError } from '../core/error/repo-guard-error.js';
import { validateProjectDescriptor } from '../profiles/project-profiles.js';
import { validateChecksConfiguration } from './checks-validation.js';
import { validateCiConfiguration } from './ci-validation.js';
import { validateCommitAnimationConfiguration } from './commit-animation-validation.js';
import { validateCommitMessageConfiguration } from './commit-message-validation.js';
import { validateCodePlacementConfiguration } from './code-placement-validation.js';
import { validateDependencyPolicyConfiguration } from './dependency-policy-validation.js';
import { validateDeliveryContractConfiguration } from './delivery-contract-validation.js';
import { validateExceptionConfiguration } from './exception-validation.js';
import { validateNotificationConfiguration } from './notification-validation.js';
import { validateRepositoryFilePlacementConfiguration } from './repository-file-placement.js';
import {
  normalizeProtectedFileConfiguration,
  validateProtectedFileConfigurationShape,
} from './protected-file-validation.js';
import { validateRootConfigurationContract } from './root-configuration-validation.js';
import { DEFAULT_REPOSITORY_RULES } from './project-defaults.js';
import { REPOSITORY_FIELDS } from './project-feature-paths.js';
import {
  CONFIG_FILE,
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

function sectionValue(value, fields, label) {
  const section = value === undefined ? {} : value;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(section, new Set(fields), label);
  return section;
}

function assertNoDiscardedNulls(value, normalized, configPath, segments = []) {
  if (value === null) {
    if (normalized !== null) {
      throw configValidationError(
        `${configPath} ${segments.join('.')} 不允许为空值`,
      );
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, candidate] of Object.entries(value)) {
    assertNoDiscardedNulls(candidate, normalized?.[key], configPath, [
      ...segments,
      key,
    ]);
  }
}

export function validateConfigValue(
  value,
  configPath = CONFIG_FILE,
  options = {},
) {
  validateRootConfigurationContract(value, configPath);
  const project = options.repositoryOnly
    ? undefined
    : validateProjectDescriptor(value.project, options);
  const repository = sectionValue(
    value.repository,
    REPOSITORY_FIELDS,
    `${configPath} repository`,
  );
  const protectedFiles = {
    ...repository,
    rules: repository.rules ?? DEFAULT_REPOSITORY_RULES,
  };
  validateProtectedFileConfigurationShape(protectedFiles, configPath);
  const reporting = sectionValue(
    value.reporting,
    ['notification', 'commitAnimation'],
    `${configPath} reporting`,
  );
  if (project?.stack === 'java' && repository.dependencyPolicy?.enabled === true) {
    throw configValidationError(`${configPath} repository.dependencyPolicy 仅适用于 Node 依赖；Java 项目请配置 checks.javaDependencies。`);
  }
  const projectRepository = project?.stack === 'java'
    ? { ...repository, dependencyPolicy: { enabled: false, ...repository.dependencyPolicy } }
    : repository;
  const normalized = {
    version: 2,
    ...(project ? { project } : {}),
    checks: validateChecksConfiguration(value.checks, project, configPath),
    repository: {
      ...normalizeProtectedFileConfiguration(protectedFiles, configPath),
      filePlacement: validateRepositoryFilePlacementConfiguration(repository, configPath),
      codePlacement: validateCodePlacementConfiguration(repository, configPath),
      exceptions: validateExceptionConfiguration(repository, configPath),
      dependencyPolicy: validateDependencyPolicyConfiguration(
        projectRepository,
        configPath,
      ),
      commitMessage: validateCommitMessageConfiguration(repository, configPath),
      deliveryContract: validateDeliveryContractConfiguration(
        repository,
        configPath,
      ),
    },
    reporting: {
      notification: validateNotificationConfiguration(reporting, configPath),
      commitAnimation: validateCommitAnimationConfiguration(
        reporting,
        configPath,
      ),
    },
    ci: validateCiConfiguration(value.ci, configPath),
  };
  assertNoDiscardedNulls(value, normalized, configPath);
  return normalized;
}

export function validateConfig(value, configPath = CONFIG_FILE, options = {}) {
  try {
    return validateConfigValue(value, configPath, options);
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
