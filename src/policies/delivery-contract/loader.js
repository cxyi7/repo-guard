import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeGitPath } from '../../config/path-matching.js';
import { executionError } from '../../core/error/repo-guard-error.js';
import {
  listFilesAtRevision,
  readFileAtRevision,
} from '../../git/delivery-contract-facts.js';
import {
  listIndexFiles,
  readIndexFileBuffer,
  readIndexTextFiles,
} from '../../git/index-content.js';

function absolutePath(root, relativePath) {
  return path.join(root, ...normalizeGitPath(relativePath).split('/'));
}

export function createDeliveryContractRevisionLoader({ root, revision, config }) {
  const trackedFiles = new Set(listFilesAtRevision(root, revision, config.contractsDirectory));
  const readBuffer = (relativePath) => {
    const value = readFileAtRevision(root, revision, relativePath);
    if (value == null) {
      throw executionError(
        'delivery-contract/revision-file-missing',
        `提交 ${revision} 中不存在 ${relativePath}`,
      );
    }
    return value;
  };
  return Object.freeze({
    contractPaths: Object.freeze([]),
    readBuffer,
    readText: (relativePath) => readBuffer(relativePath).toString('utf8'),
    trackedFiles,
  });
}

export function createDeliveryContractLoader({ root, environment, config }) {
  const trackedFiles = new Set(listIndexFiles(root));
  const fromIndex = environment === 'pre-commit';

  const readBuffer = (relativePath) => (
    fromIndex
      ? readIndexFileBuffer(root, relativePath)
      : readFileSync(absolutePath(root, relativePath))
  );
  const readText = (relativePath) => (
    fromIndex
      ? readIndexTextFiles(root, [relativePath])[0].content
      : readFileSync(absolutePath(root, relativePath), 'utf8')
  );
  const contractPrefix = `${config.contractsDirectory}/`;
  const contractPaths = [...trackedFiles]
    .filter((filePath) => {
      if (!filePath.startsWith(contractPrefix) || !filePath.endsWith('.md')) return false;
      const relativePath = filePath.slice(contractPrefix.length);
      return relativePath !== '' && !relativePath.includes('/');
    })
    .sort();

  return Object.freeze({
    contractPaths: Object.freeze(contractPaths),
    readBuffer,
    readText,
    trackedFiles,
  });
}
