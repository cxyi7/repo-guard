import { runGit } from './execution.js';

export function collectTrackedProjectPaths(root) {
  return runGit(
    ['ls-files', '--cached', '-z'],
    { cwd: root },
  ).stdout
    .split('\0')
    .filter(Boolean)
    .map((filePath) => filePath.replaceAll('\\', '/'));
}
