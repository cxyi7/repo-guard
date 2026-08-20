import { isUtf8 } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';
import {
  readCurrentGitAuthor,
  readFileCreationGitAuthor,
} from '../../git/file-history.js';
import { synchronizeFileHeaderContent } from '../../policies/file-header.js';

function changeForPath(changes, relativePath) {
  return changes.find((change) => change.path === relativePath) ?? null;
}

function creationIdentity(root, relativePath, change, currentIdentity) {
  if (change?.status.startsWith('A') || change?.status.startsWith('C')) {
    return currentIdentity;
  }
  const historyPath = change?.oldPath || relativePath;
  const identity = readFileCreationGitAuthor(root, historyPath);
  if (identity) return identity;
  throw executionError(
    'file-header/creation-history-missing',
    `无法从 Git 历史读取文件的创建记录：${relativePath}`,
    {
      expected: '已跟踪文件必须能够通过完整 Git 历史追溯首次新增提交。',
      remediation: {
        goal: '补全仓库历史后重新同步文件头',
        steps: ['如果当前仓库是浅克隆，请先获取完整历史', '重新暂存文件并再次提交'],
      },
    },
  );
}

export function synchronizeStagedFileHeaders({ root, files, changes }) {
  if (files.length === 0) return Object.freeze({ checked: 0, changed: 0 });
  const currentIdentity = readCurrentGitAuthor(root);
  let changed = 0;
  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const change = changeForPath(changes, relativePath);
    const created = creationIdentity(root, relativePath, change, currentIdentity);
    const bytes = readFileSync(file);
    if (!isUtf8(bytes)) {
      throw executionError(
        'file-header/non-utf8-file',
        `文件不是有效 UTF-8 文本，拒绝写入文件头：${relativePath}`,
        { expected: '受文件头管理的源文件必须使用 UTF-8 编码。' },
      );
    }
    const original = bytes.toString('utf8');
    const updated = synchronizeFileHeaderContent(original, relativePath, {
      author: created.name,
      date: created.date,
      lastEditor: currentIdentity.name,
      lastEditTime: currentIdentity.date,
    });
    if (updated !== original) {
      writeFileSync(file, updated, 'utf8');
      changed += 1;
    }
  }
  return Object.freeze({ checked: files.length, changed });
}
