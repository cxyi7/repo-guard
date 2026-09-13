import { validateSourceSecurity } from './source-security.js';
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

import { validateUnitTestConfiguration } from './unit-test-validation.js';
import { JAVA_PROJECT_CHECKS, NODE_ONLY_PROJECT_CHECKS, PROJECT_CHECK_PATHS } from './project-feature-paths.js';
import { projectCheckDefaults } from './project-defaults.js';
import { validateJavaSourceChecks } from './java-source.js';
import { validateJavaEngineeringChecks } from './java-engineering.js';
import { validateJavaPathNamingChecks } from './java-path-naming.js';
import { validateJavaSpotbugsChecks } from './java-spotbugs.js';
import { validateJavaMutationChecks } from './java-mutation.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

const FRONTEND_ONLY = [
  'lighthouse',
  'asyncResourceCleanup',
];
const CHILD_CHECKS = {
  imageAssets: { unused: 'unusedImageAssets' },
  unitTest: {
    coverage: 'coverage',
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

/** 各领域校验器只接收本领域选项，样式子能力保留在统一 stylelint 配置内。 */
export function validateChecksConfiguration(value, project, configPath) {
  const checks = checksValue(value, project, configPath);
  const unsupportedChecks = project?.stack === 'java'
    ? NODE_ONLY_PROJECT_CHECKS : JAVA_PROJECT_CHECKS;
  for (const feature of unsupportedChecks) {
    if (checks[feature].enabled === true) {
      throw configValidationError(`${configPath} checks.${feature} 不适用于当前项目技术栈，请使用该项目对应的检查。`);
    }
  }
  if (project?.stack === 'java' && checks.mutationTest.guardedBuilds?.length > 0) {
    throw configValidationError(`${configPath} checks.mutationTest.guardedBuilds 仅适用于 Node 项目的 npm 构建脚本。`);
  }
  const stylelint = validateStylelintConfiguration(checks, configPath);
  if (project?.role === 'backend' && (stylelint.governance.enabled || stylelint.uiTokens.enabled)) throw configValidationError('checks.stylelint.governance 和 checks.stylelint.uiTokens 仅适用于前端项目。');
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
  const { coverage, ...unitTest } =
    validateUnitTestConfiguration(
      {
        unitTest: {
          ...checks.unitTest,
          coverage: checks.coverage,
        },
      },
      configPath,
    );
  const normalized = {
    sourceSecurity: validateSourceSecurity(checks.sourceSecurity, project),
    eslint: validateEslintConfiguration(checks, configPath),
    prettier: validatePrettierConfiguration(checks, configPath),
    stylelint,
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
    architecture: validateArchitectureConfiguration(checks, configPath),
    ...validateExecutionGateConfiguration(checks, configPath),
    unitTest,
    coverage,
    mutationTest: validateMutationTestConfiguration(checks, configPath),
    ...validateJavaSourceChecks(checks, { configPath, project }),
    ...validateJavaEngineeringChecks(checks, { configPath, project }),
    ...validateJavaPathNamingChecks(checks, { configPath, project }),
    ...validateJavaSpotbugsChecks(checks, { configPath, project }),
    ...validateJavaMutationChecks(checks, { configPath, project }),
  };
  if (stylelint.enabled && stylelint.uiTokens.enabled && stylelint.uiTokens.artifacts.enabled
    && (!normalized.build.enabled || !normalized.build.artifactBudget.enabled || !normalized.build.artifactBudget.cleanScript)) {
    throw configValidationError(`${configPath} UI Token 产物检查要求开启 checks.build、artifactBudget 并配置精确的 cleanScript。`);
  }
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
