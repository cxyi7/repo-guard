import { parseNameStatus } from './git-changes.js';
import { gitValue, runGit } from './git.js';

const ZERO_SHA = /^0+$/;
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function parsePrePushUpdates(input) {
  return String(input || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
      if (!localRef || !localSha || !remoteRef || !remoteSha) {
        throw new Error(`Unable to parse pre-push update: ${line}`);
      }
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

function diffRange(root, base, head) {
  const output = runGit([
    'diff',
    '--name-status',
    '-z',
    '--diff-filter=ACMRD',
    '--find-renames',
    base,
    head,
  ], { cwd: root }).stdout;
  return parseNameStatus(output).map((change) => ({
    ...change,
    headSha: head,
  }));
}

function newBranchBase(root, remoteName, localSha) {
  const candidates = [
    `refs/remotes/${remoteName}/HEAD`,
    `refs/remotes/${remoteName}/main`,
    `refs/remotes/${remoteName}/master`,
  ];
  for (const candidate of candidates) {
    const remoteSha = gitValue(['rev-parse', '--verify', candidate], '', root);
    if (!remoteSha) {
      continue;
    }
    const base = gitValue(['merge-base', localSha, remoteSha], '', root);
    if (base) {
      return base;
    }
  }
  return EMPTY_TREE_SHA;
}

export function collectPrePushChanges({ input, remoteName = 'origin', root }) {
  const updates = parsePrePushUpdates(input);
  if (updates.length === 0) {
    const parent = gitValue(['rev-parse', '--verify', 'HEAD^'], '', root)
      || EMPTY_TREE_SHA;
    return diffRange(root, parent, 'HEAD');
  }

  const combined = new Map();
  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) {
      continue;
    }
    const base = ZERO_SHA.test(update.remoteSha)
      ? newBranchBase(root, remoteName, update.localSha)
      : update.remoteSha;
    for (const change of diffRange(root, base, update.localSha)) {
      combined.set(
        `${change.headSha}\0${change.oldPath || ''}\0${change.path}`,
        change,
      );
    }
  }
  return [...combined.values()];
}
