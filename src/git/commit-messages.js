import { gitValue, runGit } from './execution.js';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function commitDetails(root, sha) {
  const output = runGit(
    ['show', '-s', '--format=%P%x00%B', sha],
    { cwd: root },
  ).stdout;
  const delimiter = output.indexOf('\0');
  if (delimiter < 0) {
    return Object.freeze({ sha, parents: Object.freeze([]), message: output });
  }
  const parents = output.slice(0, delimiter).trim().split(/\s+/).filter(Boolean);
  return Object.freeze({
    sha,
    parents: Object.freeze(parents),
    message: output.slice(delimiter + 1),
  });
}

export function collectCommitMessages(root, { base, head }) {
  const argumentsList = base === EMPTY_TREE_SHA
    ? ['rev-list', '--reverse', head]
    : ['rev-list', '--reverse', `${base}..${head}`];
  const revisions = runGit(argumentsList, { cwd: root }).stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return Object.freeze(revisions.map((sha) => commitDetails(root, sha)));
}

export function collectPendingCommitParents(root) {
  const head = gitValue(['rev-parse', '--verify', 'HEAD'], '', root);
  const mergeHead = gitValue(['rev-parse', '--verify', 'MERGE_HEAD'], '', root);
  return Object.freeze(head && mergeHead ? [head, mergeHead] : []);
}
