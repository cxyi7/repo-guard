import { pathToFileURL } from 'node:url';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';

export function resolveProjectEslintMetadata(root) {
  return resolveProjectPackageMetadata(root, 'eslint', 'ESLint');
}

export async function loadProjectEslint(root) {
  const metadata = resolveProjectEslintMetadata(root);
  const eslintModule = await import(pathToFileURL(metadata.entryPath).href);
  const ESLint = eslintModule.ESLint || eslintModule.default?.ESLint;

  if (typeof ESLint !== 'function') {
    throw configurationError(
      'eslint/unsupported-project-api',
      `Unsupported ESLint ${metadata.version}: the ESLint class is not available`,
    );
  }

  return {
    ESLint,
    version: metadata.version,
  };
}

function normalizeImportedModule(module) {
  return module.default ?? module;
}

export async function loadProjectEslintIntegration(
  root,
  packageName,
  displayName,
  required,
) {
  let metadata;
  try {
    metadata = resolveProjectPackageMetadata(root, packageName, displayName);
  } catch (error) {
    if (!required && error?.code === 'project-package/dependency-not-installed') {
      return null;
    }
    throw toRepoGuardError(error, {
      kind: 'configuration',
      code: 'eslint/integration-resolution-failed',
    });
  }

  const imported = await import(pathToFileURL(metadata.entryPath).href);
  return {
    module: normalizeImportedModule(imported),
    version: metadata.version,
  };
}
