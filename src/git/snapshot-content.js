import { executionError } from '../core/error/repo-guard-error.js';
import { createGitCommandError } from './command-error.js';
import { runGit } from './execution.js';

/** 初始仓库可没有 HEAD；Git 检查本身失败时仍保留执行错误。 */
export function hasHeadCommit(root) {
  const result = runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, allowFailure: true });
  if (result.status === 0) return true;
  if (result.status === 1 && !result.stderr.trim()) return false;
  throw createGitCommandError(result, { cwd: root });
}

/** 先从索引或树对象确认文件，再读取固定 blob；读取失败不等同于文件缺失。 */
export function readOptionalSnapshotFile(root, revision, relativePath) {
  const staged = revision === '';
  const argumentsList = staged
    ? ['ls-files', '--stage', '-z', '--', `:(literal)${relativePath}`]
    : ['ls-tree', '-z', revision, '--', relativePath];
  const records = runGit(argumentsList, { cwd: root }).stdout.split('\0').filter(Boolean);
  const entries = records.flatMap((record) => {
    const separator = record.indexOf('\t');
    if (record.slice(separator + 1) !== relativePath) return [];
    const fields = record.slice(0, separator).split(' ');
    return [{ objectId: fields[staged ? 1 : 2], readable: staged ? fields[2] === '0' : fields[1] === 'blob' }];
  });
  const hasChildren = records.some((record) => record.slice(record.indexOf('\t') + 1)
    .startsWith(`${relativePath}/`));
  if (entries.length === 0 && !hasChildren) return null;
  if (entries.length !== 1 || !entries[0].readable || !/^[0-9a-f]{40,64}$/.test(entries[0].objectId)) {
    throw executionError('git/snapshot-entry-unreadable', `Git 快照文件未合并或不是可读取的文件：${relativePath}`, {
      details: { location: { path: relativePath } },
      expected: '索引或提交树中的目标必须是唯一且已合并的文件对象。',
    });
  }
  return runGit(['cat-file', 'blob', entries[0].objectId], { cwd: root }).stdout;
}
