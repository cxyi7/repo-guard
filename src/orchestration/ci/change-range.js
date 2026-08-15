import { collectRevisionChanges } from '../../git-changes.js';
import { rangeError } from '../../core/error/repo-guard-error.js';
import { gitValue } from '../../git.js';

const ZERO_SHA = /^0+$/;

function assertCommit(root, revision, label) {
  if (!revision || ZERO_SHA.test(revision)) return null;
  const commit = gitValue(['rev-parse', '--verify', `${revision}^{commit}`], '', root);
  if (!commit) {
    throw rangeError(
      `ci-range/${label}-revision-unavailable`,
      `CI ${label} revision is unavailable: ${revision}. Fetch enough Git history and retry.`,
      {
        details: { evidence: [{ type: 'git-revision', message: `${label} revision could not be resolved` }] },
        expected: `CI ${label} revision exists in the fetched Git history.`,
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
        'CI base revision is unavailable. GitLab must provide '
        + 'CI_MERGE_REQUEST_DIFF_BASE_SHA or CI_COMMIT_BEFORE_SHA.',
        { expected: 'GitLab provides a non-zero merge-request or previous-commit base SHA.' },
      );
    }
    resolvedBase = gitValue(['rev-parse', '--verify', `${resolvedHead}^`], '', root);
  }
  resolvedBase = assertCommit(root, resolvedBase, 'base');
  if (!resolvedBase) {
    throw rangeError(
      'ci-range/base-revision-unresolved',
      'CI base revision could not be resolved',
      { expected: 'A valid base commit can be resolved before collecting CI changes.' },
    );
  }

  return {
    base: resolvedBase,
    changes: collectRevisionChanges(root, resolvedBase, resolvedHead),
    head: resolvedHead,
  };
}
