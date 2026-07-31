import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from './config.js';
import { buildManagedTextBlock } from './managed-text-block.js';

export const GIT_ATTRIBUTES_FILE = '.gitattributes';
export const ATTRIBUTES_START_MARKER = '# repo-guard-managed:attributes:start';
export const ATTRIBUTES_END_MARKER = '# repo-guard-managed:attributes:end';

const MANAGED_ATTRIBUTE_LINES = [
  '.githooks/* text eol=lf',
  `${CONFIG_FILE} text eol=lf`,
];

export function ensureGitAttributes(root) {
  const target = path.join(root, GIT_ATTRIBUTES_FILE);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: ATTRIBUTES_END_MARKER,
    managedLines: MANAGED_ATTRIBUTE_LINES,
    startMarker: ATTRIBUTES_START_MARKER,
    target: GIT_ATTRIBUTES_FILE,
  });

  if (next === current) {
    return {
      changed: false,
      path: target,
    };
  }

  writeFileSync(target, next, 'utf8');
  return {
    changed: true,
    path: target,
  };
}
