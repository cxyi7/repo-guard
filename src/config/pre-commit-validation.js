import { validateAsyncResourceCleanupConfiguration } from './async-resource-cleanup-validation.js';
import { validateEslintConfiguration } from './eslint-validation.js';
import { validateFileHeaderConfiguration } from './file-header-validation.js';
import { validateFilePlacementConfiguration } from './file-placement-validation.js';
import { validateFunctionDocConfiguration } from './function-doc-validation.js';
import { validateMaxFileLinesConfiguration } from './max-file-lines-validation.js';
import { validatePathNamingConfiguration } from './path-naming-validation.js';
import { validatePrettierConfiguration } from './prettier-validation.js';
import { validateStylelintConfiguration } from './stylelint-validation.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validatePreCommitConfiguration(value, configPath) {
  const preCommitValue = value.preCommit ?? {};
  if (!preCommitValue || typeof preCommitValue !== 'object' || Array.isArray(preCommitValue)) {
    throw configValidationError(`${configPath} preCommit 必须是对象`);
  }
  assertKnownProperties(
    preCommitValue,
    new Set([
      'eslint',
      'prettier',
      'stylelint',
      'maxFileLines',
      'filePlacement',
      'fileHeader',
      'functionDocs',
      'asyncResourceCleanup',
      'pathNaming',
    ]),
    `${configPath} preCommit`,
  );

  const asyncResourceCleanup = validateAsyncResourceCleanupConfiguration(
    preCommitValue,
    configPath,
  );
  const fileHeader = validateFileHeaderConfiguration(preCommitValue, configPath);
  const functionDocs = validateFunctionDocConfiguration(preCommitValue, configPath);
  const filePlacement = validateFilePlacementConfiguration(preCommitValue, configPath);
  const pathNaming = validatePathNamingConfiguration(preCommitValue, configPath);
  const maxFileLines = validateMaxFileLinesConfiguration(preCommitValue, configPath);
  const stylelint = validateStylelintConfiguration(preCommitValue, configPath);
  const prettier = validatePrettierConfiguration(preCommitValue, configPath);
  const eslint = validateEslintConfiguration(preCommitValue, configPath);

  return {
    asyncResourceCleanup,
    fileHeader,
    functionDocs,
    filePlacement,
    maxFileLines,
    pathNaming,
    stylelint,
    prettier,
    eslint,
  };
}
