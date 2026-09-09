import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';

export function assertOperationsFileLocation(root, relative) {
  let current = realpathSync(root);
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw configurationError('operations/symlink-target', `运维文件路径不得经过符号链接：${relative}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw toRepoGuardError(error, {
          code: 'operations/file-location-unreadable',
          kind: 'configuration',
          message: `无法检查运维文件路径：${relative}`,
          remediation: '请检查运维文件及其父目录是否可读取，并排除符号链接。',
        });
      }
    }
  }
}
