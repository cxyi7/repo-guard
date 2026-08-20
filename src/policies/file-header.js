import path from 'node:path';
import micromatch from 'micromatch';
import { securityError } from '../core/error/repo-guard-error.js';

const HTML_COMMENT_EXTENSIONS = new Set(['.vue', '.html']);
const STYLE_EXTENSIONS = new Set(['.css', '.less', '.scss', '.sass']);
const DESCRIPTION_FIELD_PATTERN = /@Description\s*:/;
const AUTHOR_FIELD_PATTERN = /@Author\s*:/;
const DATE_FIELD_PATTERN = /@Date\s*:/;
const EDITOR_FIELD_PATTERN = /@LastEditors?\s*:|@LastEditTime\s*:/;

function commentStyle(filePath) {
  return HTML_COMMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    ? 'html'
    : 'block';
}

function matchesAny(filePath, patterns) {
  return patterns.length > 0 && micromatch.isMatch(filePath, patterns, { dot: true });
}

export function selectFileHeaderFiles(files, config) {
  if (!config.enabled) return [];
  const extensions = new Set(config.extensions);
  return files
    .filter(({ relative }) => extensions.has(path.extname(relative).toLowerCase()))
    .filter(({ relative }) => matchesAny(relative, config.include))
    .filter(({ relative }) => !matchesAny(relative, config.exclude))
    .map(({ absolute }) => absolute);
}

function lineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function splitPrefix(content, style, filePath) {
  let prefix = '';
  let body = content;
  if (body.startsWith('\uFEFF')) {
    prefix = '\uFEFF';
    body = body.slice(1);
  }
  if (style === 'block' && body.startsWith('#!')) {
    const lineBreak = body.search(/\r?\n/);
    if (lineBreak === -1) {
      return { prefix: `${prefix}${body}\n`, body: '' };
    }
    const length = body[lineBreak] === '\r' ? lineBreak + 2 : lineBreak + 1;
    prefix += body.slice(0, length);
    body = body.slice(length);
  }
  if (STYLE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && /^@charset\s+/i.test(body)) {
    const lineBreak = body.search(/\r?\n/);
    if (lineBreak === -1) {
      return { prefix: `${prefix}${body}\n`, body: '' };
    }
    const length = body[lineBreak] === '\r' ? lineBreak + 2 : lineBreak + 1;
    prefix += body.slice(0, length);
    body = body.slice(length);
  }
  return { prefix, body };
}

function isManagedHeader(comment) {
  return DESCRIPTION_FIELD_PATTERN.test(comment)
    || EDITOR_FIELD_PATTERN.test(comment)
    || (AUTHOR_FIELD_PATTERN.test(comment) && DATE_FIELD_PATTERN.test(comment));
}

function leadingManagedComment(body, style) {
  const pattern = style === 'html'
    ? /^(?:[\t ]*\r?\n)*[\t ]*<!--[^]*?-->/
    : /^(?:[\t ]*\r?\n)*[\t ]*\/\*[^]*?\*\//;
  const match = body.match(pattern);
  if (!match || !isManagedHeader(match[0])) return null;
  return match[0];
}

function descriptionFrom(header) {
  return header?.match(/@Description\s*:\s*([^\r\n]*)/)?.[1]?.trim() ?? '';
}

function assertSafeField(field, value) {
  if (typeof value !== 'string' || /[\r\n]|-->|\*\//.test(value)) {
    throw securityError(
      'file-header/unsafe-field',
      `文件头字段 ${field} 包含无法安全写入注释的字符`,
      { expected: '文件头字段必须是单行文本，且不得包含注释结束符。' },
    );
  }
}

function assertSafeMetadata(metadata, description) {
  for (const [field, value] of Object.entries(metadata)) {
    assertSafeField(field, value);
  }
  assertSafeField('Description', description);
}

export function renderFileHeader(style, metadata, description = '') {
  assertSafeMetadata(metadata, description);
  const opening = style === 'html' ? '<!--' : '/*';
  const closing = style === 'html' ? '-->' : ' */';
  return [
    opening,
    ` * @Description: ${description}`.trimEnd(),
    ` * @Author: ${metadata.author}`,
    ` * @Date: ${metadata.date}`,
    ` * @LastEditor: ${metadata.lastEditor}`,
    ` * @LastEditTime: ${metadata.lastEditTime}`,
    closing,
  ].join('\n');
}

export function synchronizeFileHeaderContent(content, filePath, metadata) {
  const style = commentStyle(filePath);
  const eol = lineEnding(content);
  const { prefix, body } = splitPrefix(content, style, filePath);
  const existing = leadingManagedComment(body, style);
  const header = renderFileHeader(style, metadata, descriptionFrom(existing)).replace(/\n/g, eol);
  if (!existing) {
    return `${prefix}${header}${eol}${body}`;
  }
  return `${prefix}${header}${body.slice(existing.length)}`;
}
