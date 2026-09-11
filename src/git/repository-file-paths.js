import { lstatSync } from 'node:fs';
import path from 'node:path';
import {
  configurationError,
  executionError,
  rangeError,
  toRepoGuardError,
} from '../core/error/repo-guard-error.js';
import { createGitCommandError } from './command-error.js';
import { runGitBinary } from './execution.js';

const REVISION_ENVIRONMENTS = new Set(['pre-push', 'ci-policy', 'ci-full', 'release-ready']);
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const FILE_MODES = new Set(['100644', '100755', '120000']);

function unreadablePaths(message) {
  return executionError('git/repository-paths-unreadable', message, {
    expected: 'Git 应返回完整、可解析且位于仓库内的文件路径清单。',
    remediation: {
      goal: '恢复完整仓库文件清单的读取。',
      steps: ['检查 Git 索引、提交对象及路径编码，修复后重试。'],
      constraints: ['不要以空文件清单替代读取失败，也不要缩小检查范围。'],
      verification: ['重新执行仓库级文件归位检查。'],
    },
  });
}

function gitOutput(run, root, args, { allowFailure = false } = {}) {
  const result = run(args, { cwd: root, allowFailure, maxBuffer: 64 * 1024 * 1024 });
  if (!result || result.error || result.signal || !Number.isInteger(result.status)
    || result.status < 0 || (!allowFailure && result.status !== 0)) {
    throw createGitCommandError(result ?? {}, { cwd: root, binary: true });
  }
  if (!Buffer.isBuffer(result.stdout)) throw unreadablePaths('Git 未返回可验证的原始文件清单。');
  let stdout;
  try {
    stdout = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  } catch (cause) {
    throw toRepoGuardError(cause, {
      code: 'git/repository-paths-encoding',
      message: 'Git 文件清单不是有效的 UTF-8 文本，无法可靠检查文件位置。',
    });
  }
  return { ...result, stdout };
}

function records(output) {
  if (!output) return [];
  if (!output.endsWith('\0')) throw unreadablePaths('Git 文件清单未完整结束，不能作为全仓库检查依据。');
  return output.slice(0, -1).split('\0');
}

function validateFilePath(file) {
  if (!file || file.includes('\\') || path.posix.isAbsolute(file) || path.win32.isAbsolute(file)
    || file.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw unreadablePaths('Git 文件清单包含无法可靠表示的仓库相对路径。');
  }
  return file;
}

function parseEntries(output, source) {
  const paths = [];
  const gitlinks = [];
  const seen = new Set();
  for (const record of records(output)) {
    const separator = record.indexOf('\t');
    const metadata = record.slice(0, separator).split(' ');
    const [mode, second, third] = metadata;
    const objectId = source === 'index' ? second : third;
    if (separator < 0 || metadata.length !== 3 || !OBJECT_ID.test(objectId)
      || (!FILE_MODES.has(mode) && mode !== '160000')
      || (source === 'index' ? !/^[0-3]$/.test(third) : second !== (mode === '160000' ? 'commit' : 'blob'))) {
      throw unreadablePaths('Git 文件清单包含不完整或未知类型的条目。');
    }
    const file = validateFilePath(record.slice(separator + 1));
    if (source === 'index' && third !== '0') {
      throw rangeError('git/repository-index-unmerged', 'Git 暂存区仍有未解决的合并冲突，无法确定完整提交文件清单。', {
        details: { evidence: [{ message: `冲突路径：${file}` }] },
        remediation: {
          goal: '解决索引冲突后检查完整提交文件清单。',
          steps: ['解决冲突，并将最终文件状态加入暂存区。'],
          constraints: ['不要任意选择某一冲突阶段作为完整提交内容。'],
          verification: ['重新执行仓库级文件归位检查。'],
        },
      });
    }
    if (seen.has(file)) throw unreadablePaths('Git 文件清单包含重复路径，无法确认检查范围。');
    seen.add(file);
    (mode === '160000' ? gitlinks : paths).push(file);
  }
  return { paths, gitlinks };
}

function revisionEntries(run, root, revision) {
  const head = revision?.head;
  if (typeof head !== 'string' || !OBJECT_ID.test(head)) {
    throw rangeError('git/repository-revision-required', '仓库级文件归位检查需要已解析的完整提交标识 revision.head。');
  }
  const verified = gitOutput(run, root, ['--no-replace-objects', 'rev-parse', '--verify', '--quiet', `${head}^{commit}`], { allowFailure: true });
  if (verified.status !== 0 || verified.stdout.trim().toLowerCase() !== head.toLowerCase()) {
    throw rangeError('git/repository-revision-unavailable', '指定提交不存在或不是可直接验证的提交对象，无法读取完整文件树。');
  }
  const output = gitOutput(run, root, ['--no-replace-objects', 'ls-tree', '-r', '-z', head]).stdout;
  return { ...parseEntries(output, 'revision'), revision: head.toLowerCase() };
}

function committedIndexEntries(run, root, indexed) {
  const indexedPaths = new Set([...indexed.paths, ...indexed.gitlinks]);
  const changes = (visibility) => {
    const output = gitOutput(run, root, [
      '--no-replace-objects', 'diff', '--cached', '--name-status', '--diff-filter=AD', '-z',
      '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', visibility,
    ]).stdout;
    const items = records(output);
    const parsed = new Map();
    if (items.length % 2) throw unreadablePaths('Git 暂存增删清单缺少路径或状态，无法确认实际待提交文件。');
    for (let index = 0; index < items.length; index += 2) {
      const status = items[index];
      const file = validateFilePath(items[index + 1]);
      if (!['A', 'D'].includes(status) || parsed.has(file) || (status === 'A' && !indexedPaths.has(file))) {
        throw unreadablePaths('Git 暂存增删清单与完整索引不一致，无法确认实际待提交文件。');
      }
      parsed.set(file, status);
    }
    return parsed;
  };
  // intent-to-add 在 ls-files 中存在，但不会进入提交；不能按空 blob 猜测，否则会误排除真实空文件。
  const visible = changes('--ita-visible-in-index');
  const invisible = changes('--ita-invisible-in-index');
  if ([...invisible].some(([file, status]) => status === 'A' && visible.get(file) !== 'A')
    || [...visible].some(([file, status]) => status === 'D' && invisible.get(file) !== 'D')) {
    throw unreadablePaths('Git 的两份暂存增删清单不一致，无法区分仅登记意向的文件。');
  }
  // 历史文件先删除再 add -N 时，隐藏意向后的差异表现为删除，不能只比较新增路径。
  const intentToAdd = new Set([
    ...[...visible].filter(([file, status]) => status === 'A' && invisible.get(file) !== 'A'),
    ...[...invisible].filter(([file, status]) => status === 'D' && visible.get(file) !== 'D'),
  ].map(([file]) => file));
  if ([...intentToAdd].some((file) => !indexedPaths.has(file))) {
    throw unreadablePaths('Git 新增意向路径不在索引中，无法确认实际待提交文件。');
  }
  return {
    paths: indexed.paths.filter((file) => !intentToAdd.has(file)),
    gitlinks: indexed.gitlinks.filter((file) => !intentToAdd.has(file)),
  };
}

function worktreeEntries(run, root, indexed) {
  const untracked = records(gitOutput(run, root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout);
  const candidates = new Set([...indexed.paths, ...untracked.map((file) => validateFilePath(file.replace(/\/$/, '')))]);
  const paths = [...candidates].filter((file) => {
    if (indexed.gitlinks.some((gitlink) => file === gitlink || file.startsWith(`${gitlink}/`))) return false;
    try {
      const stat = lstatSync(path.join(root, file));
      return stat.isFile() || stat.isSymbolicLink();
    } catch (cause) {
      if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return false;
      throw toRepoGuardError(cause, {
        code: 'git/repository-worktree-path-unreadable',
        message: `无法读取仓库工作区路径状态：${file}`,
      });
    }
  });
  return { paths, gitlinks: indexed.gitlinks };
}

/** 只读取路径事实；提交检查不使用工作区或应用筛选后的变更清单。 */
export function collectRepositoryFilePaths({ root, environment, revision = null, run = runGitBinary }) {
  try {
    if (!['manual', 'pre-commit'].includes(environment) && !REVISION_ENVIRONMENTS.has(environment)) {
      throw configurationError('git/repository-path-environment', '仓库级文件归位检查不支持当前执行环境。');
    }
    const top = gitOutput(run, root, ['rev-parse', '--show-toplevel'], { allowFailure: true });
    if (top.status !== 0 || !top.stdout.trim()) {
      throw configurationError('git/not-a-repository', '当前工作目录不在可读取的 Git 工作仓库中。');
    }
    const repositoryRoot = path.resolve(top.stdout.replace(/\r?\n$/, ''));
    if (REVISION_ENVIRONMENTS.has(environment)) {
      const collected = revisionEntries(run, repositoryRoot, revision);
      return { root: repositoryRoot, source: 'revision', ...collected, gitlinks: collected.gitlinks.length };
    }
    const indexed = parseEntries(gitOutput(run, repositoryRoot, ['ls-files', '--cached', '--stage', '-z']).stdout, 'index');
    const source = environment === 'pre-commit' ? 'index' : 'worktree';
    const collected = source === 'index'
      ? committedIndexEntries(run, repositoryRoot, indexed)
      : worktreeEntries(run, repositoryRoot, indexed);
    return { root: repositoryRoot, source, revision: null, paths: collected.paths, gitlinks: collected.gitlinks.length };
  } catch (cause) {
    throw toRepoGuardError(cause, { code: 'git/repository-paths-failed', message: '无法读取完整的仓库文件路径清单。' });
  }
}
