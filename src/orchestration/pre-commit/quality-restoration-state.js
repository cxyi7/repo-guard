import { createHash } from 'node:crypto';
import { runGitBinary } from '../../git/execution.js';

/** 失败后只验证 lint-staged 恢复结果，不承担回滚或再次修复。 */
export function qualityRestorationState(root) {
  const commands = [
    ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--'],
    ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--'],
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    ['stash', 'list', '--format=%H'],
  ];
  return commands.map((args) => createHash('sha256')
    .update(runGitBinary(args, { cwd: root }).stdout).digest('hex')).join(':');
}
