import { matchRule, normalizeGitPath } from './config.js';
import { runGit } from './git.js';

export function parseNameStatus(output) {
  const entries = output.split('\0');
  const changes = [];
  let index = 0;

  while (index < entries.length) {
    const status = entries[index];
    index += 1;

    if (!status) {
      continue;
    }

    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = entries[index];
      const filePath = entries[index + 1];
      if (oldPath == null || filePath == null) {
        throw new Error('Unable to parse renamed or copied Git entry');
      }
      changes.push({
        status,
        oldPath: normalizeGitPath(oldPath),
        path: normalizeGitPath(filePath),
      });
      index += 2;
      continue;
    }

    const filePath = entries[index];
    if (filePath == null) {
      throw new Error('Unable to parse Git file entry');
    }
    changes.push({
      status,
      oldPath: null,
      path: normalizeGitPath(filePath),
    });
    index += 1;
  }

  return changes;
}

function diffChanges(root, args) {
  const output = runGit(
    [
      'diff',
      ...args,
      '--name-status',
      '-z',
      '--diff-filter=ACMRDTUXB',
      '--find-renames',
    ],
    { cwd: root },
  ).stdout;
  return parseNameStatus(output);
}

export function collectStagedChanges(root, base = null) {
  const args = ['--cached'];
  if (base) {
    args.push(base);
  }
  return diffChanges(root, args);
}

export function collectWorkingTreeChanges(root) {
  const combined = new Map();

  const append = (change, state) => {
    const key = `${change.oldPath || ''}\0${change.path}`;
    const current = combined.get(key) || {
      ...change,
      states: new Set(),
    };
    current.states.add(state);
    combined.set(key, current);
  };

  for (const change of collectStagedChanges(root)) {
    append(change, 'staged');
  }

  for (const change of diffChanges(root, [])) {
    append(change, 'unstaged');
  }

  const untracked = runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  ).stdout
    .split('\0')
    .filter(Boolean);

  for (const filePath of untracked) {
    append(
      {
        status: '??',
        oldPath: null,
        path: normalizeGitPath(filePath),
      },
      'untracked',
    );
  }

  return [...combined.values()].map((change) => ({
    ...change,
    states: [...change.states].sort(),
  }));
}

export function classifyChanges(changes, config) {
  return changes.flatMap((change) => {
    const rule = matchRule(change.path, config)
      || (change.oldPath ? matchRule(change.oldPath, config) : null);
    return rule ? [{ ...change, ...rule }] : [];
  });
}

export function displayPath(change) {
  return change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path;
}
