import path from 'node:path';
import micromatch from 'micromatch';
import { runGit } from '../git.js';

function matches(filePath, patterns, { nocase = false } = {}) {
  return micromatch.isMatch(filePath, patterns, {
    dot: true,
    nocase,
  });
}

function isDeleted(change) {
  return change.status.startsWith('D');
}

function isNewLocation(change) {
  return change.status === '??'
    || change.status.startsWith('A')
    || change.status.startsWith('C')
    || change.status.startsWith('R');
}

function shouldCheck(change, mode) {
  if (isDeleted(change)) {
    return false;
  }
  return mode === 'changedFiles' || isNewLocation(change);
}

export function inspectFilePlacement({ changes, config, files = null }) {
  const includedFiles = files ? new Set(files) : null;
  const violations = [];
  let checkedCount = 0;

  for (const change of changes) {
    if (
      !shouldCheck(change, config.mode)
      || (includedFiles && !includedFiles.has(change.path))
    ) {
      continue;
    }
    const rule = config.rules.find(({ patterns }) => (
      matches(change.path, patterns, { nocase: true })
    ));
    if (!rule) {
      continue;
    }
    checkedCount += 1;
    if (
      matches(change.path, rule.exceptions)
      || matches(change.path, rule.allowedPatterns)
    ) {
      continue;
    }
    violations.push({
      ...change,
      rule,
      suggestedPath: `${rule.suggestedDirectory}/${path.posix.basename(change.path)}`,
    });
  }

  return { checkedCount, violations };
}


export function collectProjectFiles(root) {
  const parsePaths = (output) => output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => filePath.replace(/\\/g, '/'));
  const deleted = new Set(parsePaths(runGit(
    ['ls-files', '--deleted', '-z'],
    { cwd: root },
  ).stdout));

  return parsePaths(runGit(
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  ).stdout).filter((filePath) => !deleted.has(filePath));
}
