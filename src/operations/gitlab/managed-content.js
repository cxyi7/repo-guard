import { createHash } from 'node:crypto';

const DIGEST_PREFIX = '# repo-guard-content-sha256: ';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function markManagedContent(content) {
  const separator = content.indexOf('\n');
  return `${content.slice(0, separator + 1)}${DIGEST_PREFIX}${digest(content)}\n${content.slice(separator + 1)}`;
}

function contentWithoutDigest(content) {
  return content.replace(/^# repo-guard-content-sha256: [a-f0-9]{64}\n/m, '');
}

export function managedContentIsUnmodified(content) {
  const normalized = content.replace(/\r\n?/g, '\n');
  const recorded = /^# repo-guard-content-sha256: ([a-f0-9]{64})$/m.exec(normalized)?.[1];
  return Boolean(recorded) && recorded === digest(contentWithoutDigest(normalized));
}
