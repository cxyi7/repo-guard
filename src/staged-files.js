import path from 'node:path';
import { securityError } from './core/error/repo-guard-error.js';

export function normalizeStagedFiles(root, files, label) {
  const uniqueFiles = new Map();

  for (const file of files) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw securityError(
        'staged-files/outside-repository',
        `${label} staged file is outside the repository`,
        {
          details: { evidence: [{ type: 'scope-escape', message: `rejected staged path: ${String(file)}` }] },
          expected: '暂存文件规范化后仍位于当前仓库根目录内。',
        },
      );
    }

    uniqueFiles.set(absolute, {
      absolute,
      relative: relative.replace(/\\/g, '/'),
    });
  }

  return [...uniqueFiles.values()];
}
