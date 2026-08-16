import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';

export function readUnitTestProjectPackage(root) {
  const target = path.join(root, 'package.json');
  return existsSync(target)
    ? JSON.parse(readFileSync(target, 'utf8'))
    : null;
}

export function resolveUnitTestProjectTools(root, config) {
  return {
    vitest: resolveProjectPackageMetadata(root, 'vitest', 'Vitest 工具'),
    vueTestUtils: config.componentInteraction.enabled
      ? resolveProjectPackageMetadata(root, '@vue/test-utils', 'Vue Test Utils 工具')
      : null,
  };
}
