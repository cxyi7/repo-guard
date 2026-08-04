import { readFileSync } from 'node:fs';
import path from 'node:path';

const STYLE_TAG = /<style\b([^>]*)>/gi;
const LANG_ATTRIBUTE = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

export function collectVueStyleLanguages(content) {
  const languages = new Set();
  let match;

  while ((match = STYLE_TAG.exec(content)) !== null) {
    const attributes = match[1] || '';
    const langMatch = LANG_ATTRIBUTE.exec(attributes);
    const language = (langMatch?.[1] || langMatch?.[2] || langMatch?.[3] || 'css')
      .trim()
      .toLowerCase();
    languages.add(language || 'css');
  }

  return [...languages].sort();
}

export function assertVueStyleLanguages(files, root) {
  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.vue') {
      continue;
    }

    const languages = collectVueStyleLanguages(readFileSync(file, 'utf8'));
    if (languages.length > 1) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      throw new Error(
        `${relative} contains multiple <style> languages: ${languages.join(', ')}. `
        + 'Use one style language per Vue file before committing.',
      );
    }
  }
}
