import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildManagedTextBlock,
  managedTextIsCurrent,
} from '../../core/policy/managed-text-block.js';

export const LIGHTHOUSE_OUTPUT_DIRECTORY = '.lighthouseci/';
const START_MARKER = '# repo-guard-managed:lighthouse:start';
const END_MARKER = '# repo-guard-managed:lighthouse:end';

export function ensureLighthouseIgnore(
  root,
  coverageDirectory = 'coverage',
  mutationReportsDirectory = null,
) {
  const target = path.join(root, '.gitignore');
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: END_MARKER,
    managedLines: [
      LIGHTHOUSE_OUTPUT_DIRECTORY,
      `${coverageDirectory.replace(/\\/g, '/').replace(/\/+$/, '')}/`,
      ...(mutationReportsDirectory
        ? [`${mutationReportsDirectory.replace(/\\/g, '/').replace(/\/+$/, '')}/`]
        : []),
    ],
    startMarker: START_MARKER,
    target: '.gitignore',
  });
  if (managedTextIsCurrent(current, next)) {
    return { changed: false, path: target };
  }
  writeFileSync(target, next, 'utf8');
  return { changed: true, path: target };
}
