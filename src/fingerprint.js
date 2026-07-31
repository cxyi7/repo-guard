import { createHash } from 'node:crypto';
import { gitValue, runGit } from './git.js';

export function createStagedFingerprint(root, protectedChanges) {
  const payload = {
    head: gitValue(['rev-parse', 'HEAD'], 'INITIAL', root),
    indexTree: runGit(['write-tree'], { cwd: root }).stdout.trim(),
    protectedChanges: [...protectedChanges]
      .sort((left, right) => {
        const leftKey = `${left.path}\0${left.oldPath || ''}\0${left.status}`;
        const rightKey = `${right.path}\0${right.oldPath || ''}\0${right.status}`;
        return leftKey.localeCompare(rightKey);
      })
      .map(({ status, path, oldPath, category, level }) => ({
        status,
        path,
        ...(oldPath ? { oldPath } : {}),
        category,
        level,
      })),
  };

  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
