import { displayPath } from './git-changes.js';

export function formatProtectedChange(change, { includeStates = false } = {}) {
  const stateText = includeStates && change.states?.length
    ? ` (${change.states.join('/')})`
    : '';
  return `[${change.level}:${change.category}] ${change.status} ${displayPath(change)}${stateText}`;
}

export function printProtectedChanges(changes, options) {
  for (const change of changes) {
    console.log(`- ${formatProtectedChange(change, options)}`);
  }
}
