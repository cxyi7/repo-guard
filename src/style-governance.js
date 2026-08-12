import { readFileSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';

const ATTRIBUTE = (name) => new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, 'i');
const MODULE_STYLE = /\.module\.(?:css|scss|sass|less)$/i;

function tagEnd(source, start) {
  let quote = null;
  let escaped = false;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor + 1;
    }
  }
  return source.length;
}

function closingTag(source, name, start) {
  const expression = new RegExp(`</${name}\\s*>`, 'gi');
  expression.lastIndex = start;
  const match = expression.exec(source);
  return match ? { end: expression.lastIndex, start: match.index } : null;
}

function findVueStyleBlocks(source) {
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start === -1) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }
    const tagMatch = /^<([A-Za-z][\w.-]*)\b/.exec(source.slice(start));
    if (!tagMatch) {
      cursor = start + 1;
      continue;
    }
    const name = tagMatch[1].toLowerCase();
    const openingEnd = tagEnd(source, start + tagMatch[0].length);
    const closing = closingTag(source, name, openingEnd);
    if (!closing) {
      cursor = openingEnd;
      continue;
    }
    if (name === 'style') {
      blocks.push({
        attributes: source.slice(start + tagMatch[0].length, openingEnd - 1),
        content: source.slice(openingEnd, closing.start),
        contentOffset: openingEnd,
        start,
      });
    }
    cursor = closing.end;
  }
  return blocks;
}

function normalizePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function sourceLocation(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '));
}

function warning(source, offset, text) {
  return {
    ...sourceLocation(source, offset),
    endLine: sourceLocation(source, offset).line,
    endColumn: sourceLocation(source, offset).column + 1,
    rule: 'no-unexpected-global-style',
    severity: 'error',
    text: `${text} (no-unexpected-global-style)`,
  };
}

function vueWarnings(source, allowed) {
  if (allowed) return [];
  const warnings = [];
  for (const block of findVueStyleBlocks(source)) {
    const { attributes, content, contentOffset } = block;
    const isolated = withoutComments(content);
    if (!ATTRIBUTE('scoped').test(attributes) && !ATTRIBUTE('module').test(attributes)) {
      warnings.push(warning(
        source,
        block.start,
        'Vue style blocks must use scoped or module unless the file is an approved global stylesheet',
      ));
    }
    const globalPattern = /(?:::v-global|:global)\s*\(/gi;
    let globalMatch;
    while ((globalMatch = globalPattern.exec(isolated)) !== null) {
      warnings.push(warning(
        source,
        contentOffset + globalMatch.index,
        ':global() escapes component style isolation and requires an approved global stylesheet',
      ));
    }
  }
  return warnings;
}

export function inspectUnexpectedGlobalStyles({ root, files, allowedPatterns }) {
  return files.flatMap((filePath) => {
    const relative = normalizePath(root, filePath);
    const allowed = micromatch.isMatch(relative, allowedPatterns, { dot: true });
    const source = readFileSync(filePath, 'utf8');
    let warnings = [];
    if (relative.toLowerCase().endsWith('.vue')) {
      warnings = vueWarnings(source, allowed);
    } else if (!allowed && !MODULE_STYLE.test(relative)) {
      warnings = [warning(
        source,
        0,
        'Global stylesheet is outside allowedGlobalStylePatterns; move it to an approved global style location or convert it to a CSS Module',
      )];
    }
    return warnings.length > 0 ? [{ source: filePath, warnings }] : [];
  });
}
