import { collectRevisionChanges } from '../../git/change-collection.js';
import { rangeError } from '../../core/error/repo-guard-error.js';
import { gitValue } from '../../git/execution.js';

const ZERO_SHA = /^0+$/;

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
      throw rangeError(
        'ci-range/base-revision-unavailable',
        'CI 基准版本不可用。GitLab 必须提供 '
        + 'CI_MERGE_REQUEST_DIFF_BASE_SHA 或 CI_COMMIT_BEFORE_SHA。',
        { expected: 'GitLab 必须提供非零的合并请求基准 SHA 或前一提交 SHA。' },
      );
    }
    resolvedBase = gitValue(['rev-parse', '--verify', `${resolvedHead}^`], '', root);
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
