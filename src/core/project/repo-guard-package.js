import { readFileSync } from 'node:fs';
import { configurationError } from '../error/repo-guard-error.js';

const PACKAGE_MANIFEST_URL = new URL('../../../package.json', import.meta.url);

export function repoGuardPackageVersion() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(PACKAGE_MANIFEST_URL, 'utf8'));
  } catch (error) {
    throw configurationError(
      'repo-guard-package/unreadable-manifest',
      `无法读取 repo-guard 自身的 package.json：${error.message}`,
      { cause: error },
    );
  }

  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw configurationError(
      'repo-guard-package/invalid-version',
      'repo-guard 自身的 package.json 必须包含精确 SemVer 版本',
    );
  }
  return manifest.version;
}
