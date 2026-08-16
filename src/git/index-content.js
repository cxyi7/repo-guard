import { runGit } from './execution.js';

export function listIndexFiles(root) {
  return runGit(['ls-files', '--cached', '-z'], { cwd: root }).stdout
    .split('\0')
    .filter(Boolean)
    .map((filePath) => filePath.replace(/\\/g, '/'));
}

export function readIndexTextFiles(root, paths) {
  return paths.map((filePath) => ({
    path: filePath,
    content: runGit(['show', `:${filePath}`], { cwd: root }).stdout,
  }));
}
