import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';

export const STYLELINT_CONFIG_FILES = Object.freeze([
  'stylelint.config.js',
  'stylelint.config.mjs',
  'stylelint.config.cjs',
  'stylelint.config.ts',
  'stylelint.config.mts',
  'stylelint.config.cts',
  '.stylelintrc',
  '.stylelintrc.json',
  '.stylelintrc.yaml',
  '.stylelintrc.yml',
  '.stylelintrc.js',
  '.stylelintrc.mjs',
  '.stylelintrc.cjs',
]);

export function resolveProjectStylelintMetadata(root) {
  const metadata = resolveProjectPackageMetadata(root, 'stylelint', 'Stylelint');
  const packageJson = JSON.parse(readFileSync(metadata.packagePath, 'utf8'));
  const importEntry = packageJson.exports?.['.']?.import?.default;

  if (typeof importEntry !== 'string') {
    return metadata;
  }

  const entryPath = path.resolve(path.dirname(metadata.packagePath), importEntry);
  return existsSync(entryPath) ? { ...metadata, entryPath } : metadata;
}

export function findProjectStylelintConfig(root) {
  const configFile = STYLELINT_CONFIG_FILES.find((file) => existsSync(path.join(root, file)));
  if (configFile) {
    return configFile;
  }

  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return Object.hasOwn(packageJson, 'stylelint') ? 'package.json#stylelint' : null;
  } catch {
    return null;
  }
}
