import { validateAccessibilityConfiguration } from './accessibility-validation.js';
import { validateArchitectureConfiguration } from './architecture-validation.js';
import { validateAsyncResourceCleanupConfiguration } from './async-resource-cleanup-validation.js';
import { validateDeadCodeConfiguration } from './dead-code-validation.js';
import { validateEslintConfiguration } from './eslint-validation.js';
import { validateExecutionGateConfiguration } from './execution-gate-validation.js';
import { validateFileHeaderConfiguration } from './file-header-validation.js';
import { validateFilePlacementConfiguration } from './file-placement-validation.js';
import { validateFunctionDocConfiguration } from './function-doc-validation.js';
import { validateImageAssetsConfiguration } from './image-assets-validation.js';
import { validateMaxFileLinesConfiguration } from './max-file-lines-validation.js';
import { validateMutationTestConfiguration } from './mutation-test-validation.js';
import { validatePathNamingConfiguration } from './path-naming-validation.js';
import { validatePrettierConfiguration } from './prettier-validation.js';
import { validateStylelintConfiguration } from './stylelint-validation.js';
import { validateUiTokenConfiguration } from './ui-token-validation.js';
import { validateUnitTestConfiguration } from './unit-test-validation.js';
import { PROJECT_CHECK_PATHS } from './project-feature-paths.js';
import { projectCheckDefaults } from './project-defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

const FRONTEND_ONLY = [
  'componentInteraction',
  'lighthouse',
  'accessibilityTest',
  'uiTokens',
  'asyncResourceCleanup',
];
const CHILD_CHECKS = {
  stylelint: { complexity: 'styleComplexity', governance: 'styleGovernance' },
  imageAssets: { unused: 'unusedImageAssets' },
  unitTest: {
    coverage: 'coverage',
    componentInteraction: 'componentInteraction',
  },
};

function checksValue(value, project, configPath) {
  const checks = value === undefined ? {} : value;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    throw configValidationError(`${configPath} checks 必须是对象`);
  }
  assertKnownProperties(
    checks,
    new Set(Object.keys(PROJECT_CHECK_PATHS)),
    `${configPath} checks`,
  );
  for (const [feature, candidate] of Object.entries(checks)) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw configValidationError(`${configPath} checks.${feature} 必须是对象`);
    }
    for (const [child, target] of Object.entries(CHILD_CHECKS[feature] ?? {})) {
      if (Object.hasOwn(candidate, child))
        throw configValidationError(
          `checks.${feature}.${child} 已移动为 checks.${target}，不得重复嵌套配置`,
        );
    }
  }
  const defaults = projectCheckDefaults(project);
  return Object.fromEntries(
    Object.keys(PROJECT_CHECK_PATHS).map((feature) => [
      feature,
      { ...defaults[feature], ...checks[feature] },
    ]),
  );
}

/** 各领域校验器只接收本领域选项，统一结果始终保留扁平 checks。 */
export function validateChecksConfiguration(value, project, configPath) {
  const checks = checksValue(value, project, configPath);
  const {
    complexity: styleComplexity,
    governance: styleGovernance,
    ...stylelint
  } = validateStylelintConfiguration(
    {
      stylelint: {
        ...checks.stylelint,
        complexity: checks.styleComplexity,
        governance: checks.styleGovernance,
      },
    },
    configPath,
  );
  const { unused: unusedImageAssets, ...imageAssets } =
    validateImageAssetsConfiguration(
      {
        imageAssets: {
          ...checks.imageAssets,
          unused: checks.unusedImageAssets,
        },
      },
      configPath,
    );
  const { coverage, componentInteraction, ...unitTest } =
    validateUnitTestConfiguration(
      {
        unitTest: {
          ...checks.unitTest,
          coverage: checks.coverage,
          componentInteraction: checks.componentInteraction,
        },
      },
      configPath,
    );
  const normalized = {
    eslint: validateEslintConfiguration(checks, configPath),
    prettier: validatePrettierConfiguration(checks, configPath),
    stylelint,
    styleComplexity,
    styleGovernance,
    maxFileLines: validateMaxFileLinesConfiguration(checks, configPath),
    filePlacement: validateFilePlacementConfiguration(checks, configPath),
    fileHeader: validateFileHeaderConfiguration(checks, configPath),
    functionDocs: validateFunctionDocConfiguration(checks, configPath),
    asyncResourceCleanup: validateAsyncResourceCleanupConfiguration(
      checks,
      configPath,
    ),
    pathNaming: validatePathNamingConfiguration(checks, configPath),
    deadCode: validateDeadCodeConfiguration(checks, configPath),
    imageAssets,
    unusedImageAssets,
    uiTokens: validateUiTokenConfiguration(checks, configPath),
    architecture: validateArchitectureConfiguration(checks, configPath),
    accessibilityTest: validateAccessibilityConfiguration(checks, configPath),
    ...validateExecutionGateConfiguration(checks, configPath),
    unitTest,
    coverage,
    componentInteraction,
    mutationTest: validateMutationTestConfiguration(checks, configPath),
  };
  if (project?.role === 'backend') {
    for (const feature of FRONTEND_ONLY) {
      if (normalized[feature].enabled)
        throw configValidationError(
          `checks.${feature} 仅适用于前端项目，不能用于后端预设`,
        );
    }
  }
  if (
    imageAssets.enabled &&
    imageAssets.naming.enabled &&
    normalized.pathNaming.enabled &&
    imageAssets.naming.convention !== normalized.pathNaming.convention
  ) {
    throw configValidationError(
      `${configPath} checks.imageAssets.naming.convention 必须与 checks.pathNaming.convention 保持一致`,
    );
  }
  return normalized;
}
