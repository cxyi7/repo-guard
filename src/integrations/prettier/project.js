import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';
import { configurationError } from '../../core/error/repo-guard-error.js';

export function resolveProjectPrettierMetadata(root) {
  return resolveProjectPackageMetadata(root, 'prettier', 'Prettier 工具');
}

export async function loadProjectPrettier(root) {
  const metadata = resolveProjectPrettierMetadata(root);
  const prettierModule = await import(pathToFileURL(metadata.entryPath).href);
  const prettier = typeof prettierModule.format === 'function'
    ? prettierModule
    : prettierModule.default;

  if (!prettier || typeof prettier.format !== 'function') {
    throw configurationError(
      'prettier/unsupported-project-api',
      `不支持 Prettier ${metadata.version}：format API 不可用`,
    );
  }

  return {
    prettier,
    version: metadata.version,
  };
}

export async function resolveProjectPrettierConfigFile(root) {
  const { prettier } = await loadProjectPrettier(root);
  return await prettier.resolveConfigFile(path.join(root, 'package.json'));
}
