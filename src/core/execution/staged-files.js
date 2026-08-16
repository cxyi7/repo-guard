import path from 'node:path';
import { securityError } from '../error/repo-guard-error.js';

export function normalizeStagedFiles(root, files, label) {
  const uniqueFiles = new Map();

  for (const file of files) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw securityError(
        'staged-files/outside-repository',
        `${label} 暂存文件位于仓库之外`,
        {
          details: { evidence: [{ type: 'scope-escape', message: `已拒绝的暂存路径： ${String(file)}` }] },
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
