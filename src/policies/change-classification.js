import { matchRule } from '../config/path-matching.js';

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
