import {
  lstatSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import path from 'node:path';
import { executionError } from '../error/repo-guard-error.js';

function projectFilePath(root, relativePath) {
  const projectRoot = path.resolve(root);
  const absolutePath = path.resolve(projectRoot, relativePath);
  if (!absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    throw executionError(
      'project-text/unsafe-path',
      `项目文本路径必须位于仓库内： ${relativePath}`,
    );
  }
  return absolutePath;
}

export function readProjectTextFiles(root, paths) {
  return paths.map((relativePath) => {
    const absolutePath = projectFilePath(root, relativePath);
    try {
      const stat = lstatSync(absolutePath);
      return {
        path: relativePath,
        content: stat.isSymbolicLink()
          ? readlinkSync(absolutePath, 'utf8')
          : readFileSync(absolutePath, 'utf8'),
      };
    } catch (error) {
      throw executionError(
        'project-text/read-failed',
        `无法读取项目文本文件： ${relativePath}`,
        { cause: error, details: { location: { path: relativePath } } },
      );
    }
  });
}
