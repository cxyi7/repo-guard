import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import {
  findVueTemplateAttributes,
  sourceLocation,
} from './integrations/vue/template-parser.js';

export const VUE_NO_V_HTML_RULE = 'vue/no-v-html';

export function findVueVHtml(source, relativePath = 'component.vue') {
  return findVueTemplateAttributes(source)
    .filter(({ name }) => (
      name === 'v-html'
      || name.startsWith('v-html:')
      || name.startsWith('v-html.')
    ))
    .map(({ offset }) => ({
      ...sourceLocation(source, offset),
      offset,
      path: relativePath,
      rule: VUE_NO_V_HTML_RULE,
    }));
}

function normalizeFiles(root, files) {
  return files.map((file) => {
    if (typeof file !== 'string') return file;
    const absolute = path.resolve(root, file);
    return {
      absolute,
      relative: path.relative(root, absolute).replace(/\\/g, '/'),
    };
  });
}

export function inspectUnsafeVueHtml({ root, files, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const file of normalizeFiles(root, files)) {
    if (!file.relative.toLowerCase().endsWith('.vue')) continue;
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findVueVHtml(source, file.relative)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}
