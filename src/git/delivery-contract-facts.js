import path from 'node:path';
import { collectRevisionChanges } from './change-collection.js';
import { gitValue, runGit, runGitBinary } from './execution.js';

function normalizeAbsolute(value, root) {
  const absolute = path.isAbsolute(value) ? value : path.resolve(root, value);
  return path.normalize(absolute).toLowerCase();
}

export function resolveDeliveryBranch(root, env = process.env) {
  return env.REPO_GUARD_SOURCE_BRANCH
    || env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME
    || env.CI_COMMIT_BRANCH
    || gitValue(['symbolic-ref', '--quiet', '--short', 'HEAD'], '', root);
}

export function resolveDeliveryContractId(env = process.env) {
  return env.REPO_GUARD_CONTRACT_ID?.trim() || '';
}

export function commitExists(root, commit) {
  return runGit(['cat-file', '-e', `${commit}^{commit}`], {
    allowFailure: true,
    cwd: root,
  }).status === 0;
}

export function isAncestorCommit(root, ancestor, descendant = 'HEAD') {
  return runGit(['merge-base', '--is-ancestor', ancestor, descendant], {
    allowFailure: true,
    cwd: root,
  }).status === 0;
}

export function currentHeadCommit(root) {
  return gitValue(['rev-parse', 'HEAD'], '', root);
}

export function resolveBranchCommit(root, branch) {
  for (const reference of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const commit = gitValue(['rev-parse', '--verify', `${reference}^{commit}`], '', root);
    if (commit) return { commit, reference };
  }
  return null;
}

export function collectContractRevisionChanges(root, base, head = 'HEAD') {
  return collectRevisionChanges(root, base, head);
}

export function readFileAtRevision(root, revision, filePath) {
  const result = runGitBinary(['show', `${revision}:./${filePath}`], {
    allowFailure: true,
    cwd: root,
  });
  return result.status === 0 ? result.stdout : null;
}

export function listFilesAtRevision(root, revision, directory) {
  return runGit([
    'ls-tree',
    '-r',
    '--name-only',
    '-z',
    revision,
    '--',
    directory,
  ], {
    allowFailure: true,
    cwd: root,
  }).stdout
    .split('\0')
    .filter(Boolean);
}

export function listFileRevisionCommits(root, filePath) {
  return runGit(['log', '--format=%H', '--follow', '--', filePath], { cwd: root })
    .stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function inspectWorktree(root) {
  const gitDirectory = gitValue(['rev-parse', '--git-dir'], '', root);
  const commonDirectory = gitValue(['rev-parse', '--git-common-dir'], '', root);
  if (!gitDirectory || !commonDirectory) {
    return { linked: false, gitDirectory, commonDirectory };
  }
  return {
    linked: normalizeAbsolute(gitDirectory, root) !== normalizeAbsolute(commonDirectory, root),
    gitDirectory,
    commonDirectory,
  };
}

export function trackedTreeIsClean(root) {
  return runGit(['status', '--porcelain', '--untracked-files=no'], { cwd: root })
    .stdout.trim() === '';
}
