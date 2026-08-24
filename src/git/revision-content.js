import { runGit } from './execution.js';

export function isTrackedPath(root, relativePath) {
  return runGit(
    ['ls-files', '--error-unmatch', '--', relativePath],
    { allowFailure: true, cwd: root },
  ).status === 0;
}

export function readFileAtRevision(root, revision, relativePath) {
  const result = runGit(
    ['show', `${revision}:${relativePath}`],
    { allowFailure: true, cwd: root },
  );
  return Object.freeze({
    exists: result.status === 0,
    content: result.status === 0 ? result.stdout : null,
  });
}
