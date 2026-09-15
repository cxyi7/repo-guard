import { collectRevisionChanges } from '../../git/change-collection.js';
import { rangeError } from '../../core/error/repo-guard-error.js';
import { gitValue, runGit } from '../../git/execution.js';

const ZERO_SHA = /^0+$/;

/** 首次分支推送只使用从 origin 获取的默认分支，不猜测父提交或本地分支。 */
function firstPushBase(root, head, env) {
  const branch = env.CI_DEFAULT_BRANCH;
  if (env.CI_PIPELINE_SOURCE !== 'push' || !env.CI_COMMIT_BRANCH
    || !ZERO_SHA.test(env.CI_COMMIT_BEFORE_SHA ?? '') || env.CI_MERGE_REQUEST_DIFF_BASE_SHA
    || !branch || branch === env.CI_COMMIT_BRANCH) return null;
  const reference = `refs/heads/${branch}`;
  if (runGit(['check-ref-format', reference], { cwd: root, allowFailure: true }).status !== 0) {
    throw rangeError('ci-range/default-branch-invalid', 'GitLab 默认分支名称无效，无法建立可信基准。');
  }
  if (gitValue(['rev-parse', '--is-shallow-repository'], '', root) !== 'false') {
    throw rangeError('ci-range/history-incomplete', '首次分支推送需要完整 Git 历史，请设置 GIT_DEPTH: "0" 后重试。');
  }
  const remoteReference = `refs/remotes/origin/${branch}`;
  runGit(['fetch', '--no-tags', 'origin', `+${reference}:${remoteReference}`], { cwd: root });
  const bases = gitValue(['merge-base', '--all', head, remoteReference], '', root).split('\n').filter(Boolean);
  if (bases.length !== 1) {
    throw rangeError('ci-range/merge-base-unavailable', '当前提交与默认分支没有唯一共同祖先，拒绝猜测检查范围。');
  }
  return bases[0];
}

function assertCommit(root, revision, label) {
  if (!revision || ZERO_SHA.test(revision)) return null;
  const commit = gitValue(['rev-parse', '--verify', `${revision}^{commit}`], '', root);
  if (!commit) {
    throw rangeError(
      `ci-range/${label}-revision-unavailable`,
      `CI ${label} 版本不可用： ${revision}。请获取足够的 Git 历史后重试。`,
      {
        details: { evidence: [{ type: 'git-revision', message: `${label} 版本无法解析` }] },
        expected: `CI ${label} 版本必须存在于已获取的 Git 历史中。`,
      },
    );
  }
  return commit;
}

export function resolveCiRange(root, {
  base = null,
  head = null,
  env = process.env,
} = {}) {
  const resolvedHead = assertCommit(root, head || env.CI_COMMIT_SHA || 'HEAD', 'head');
  let resolvedBase = base
    || env.CI_MERGE_REQUEST_DIFF_BASE_SHA
    || env.CI_COMMIT_BEFORE_SHA;

  if (!resolvedBase || ZERO_SHA.test(resolvedBase)) {
    if (env.GITLAB_CI) {
      resolvedBase = !base ? firstPushBase(root, resolvedHead, env) : null;
      if (!resolvedBase) throw rangeError(
        'ci-range/base-revision-unavailable',
        'CI 基准版本不可用。GitLab 必须提供 '
        + 'CI_MERGE_REQUEST_DIFF_BASE_SHA 或 CI_COMMIT_BEFORE_SHA；首次分支 push 可使用完整历史中的默认分支共同祖先。',
        { expected: 'GitLab 必须提供非零的合并请求基准 SHA 或前一提交 SHA。' },
      );
    } else resolvedBase = gitValue(['rev-parse', '--verify', `${resolvedHead}^`], '', root);
  }
  resolvedBase = assertCommit(root, resolvedBase, 'base');
  if (!resolvedBase) {
    throw rangeError(
      'ci-range/base-revision-unresolved',
      'CI 基准版本无法解析',
      { expected: '采集 CI 变更前必须能够解析有效的基准提交。' },
    );
  }

  return {
    base: resolvedBase,
    changes: collectRevisionChanges(root, resolvedBase, resolvedHead),
    head: resolvedHead,
  };
}
