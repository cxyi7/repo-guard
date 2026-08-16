import { matchRule } from '../config/path-matching.js';

export function classifyChanges(changes, config) {
  return changes.flatMap((change) => {
    const currentRule = matchRule(change.path, config);
    const previousRule = change.oldPath ? matchRule(change.oldPath, config) : null;
    const rule = previousRule?.level === 'block'
      ? previousRule
      : currentRule || previousRule;
    return rule ? [{ ...change, ...rule }] : [];
  });
}

export function displayPath(change) {
  return change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path;
}
