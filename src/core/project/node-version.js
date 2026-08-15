export const REQUIRED_NODE_RANGE = '>=22.23.2';

function parseNodeVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

export function nodeVersionIsSupported(
  version = process.versions.node,
  requiredRange = REQUIRED_NODE_RANGE,
) {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(String(requiredRange).replace(/^>=/, ''));
  if (!current || !minimum || !String(requiredRange).startsWith('>=')) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index];
  }
  return true;
}
