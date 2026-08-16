import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../core/error/repo-guard-error.js';

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
      throw configurationError(
        'stylelint/multiple-vue-style-languages',
        `${relative} 包含多种 <style> 语言：${languages.join(', ')}。`
        + '提交前每个 Vue 文件只能使用一种样式语言。',
        {
          details: { location: { path: relative } },
          expected: '每个 Vue 文件只使用一种 style 语言，使消费项目 Stylelint 配置可确定。',
        },
      );
    }
  }
}
