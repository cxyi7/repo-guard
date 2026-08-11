import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import { collectProjectFiles } from './file-placement.js';

export const VUE_NO_V_HTML_RULE = 'vue/no-v-html';

function readTag(source, start) {
  if (source.startsWith('<!--', start)) {
    const commentEnd = source.indexOf('-->', start + 4);
    return {
      end: commentEnd === -1 ? source.length : commentEnd + 3,
      type: 'comment',
    };
  }

  let cursor = start + 1;
  const closing = source[cursor] === '/';
  if (closing) cursor += 1;
  const nameStart = cursor;
  while (cursor < source.length && /[A-Za-z0-9:._-]/.test(source[cursor])) {
    cursor += 1;
  }
  if (cursor === nameStart) return null;

  const name = source.slice(nameStart, cursor).toLowerCase();
  const attributesStart = cursor;
  let quote = null;
  let escaped = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      let previous = cursor - 1;
      while (previous > attributesStart && /\s/.test(source[previous])) previous -= 1;
      return {
        attributesEnd: cursor,
        attributesStart,
        closing,
        end: cursor + 1,
        name,
        selfClosing: source[previous] === '/',
        start,
        type: 'tag',
      };
    }
    cursor += 1;
  }
  return null;
}

function findRawClosingTag(source, name, from) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`</${escapedName}\\s*>`, 'gi');
  expression.lastIndex = from;
  const match = expression.exec(source);
  return match ? expression.lastIndex : source.length;
}

function skipMustache(source, start) {
  let cursor = start + 2;
  let quote = null;
  let escaped = false;
  while (cursor < source.length - 1) {
    const character = source[cursor];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '}' && source[cursor + 1] === '}') {
      return cursor + 2;
    }
    cursor += 1;
  }
  return source.length;
}

function vHtmlAttributeOffsets(source, tag) {
  if (tag.closing) return [];
  const offsets = [];
  let cursor = tag.attributesStart;
  while (cursor < tag.attributesEnd) {
    while (cursor < tag.attributesEnd && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] === '/') {
      cursor += 1;
      continue;
    }
    const nameStart = cursor;
    while (
      cursor < tag.attributesEnd
      && !/[\s=>]/.test(source[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const attributeName = source.slice(nameStart, cursor).toLowerCase();
    if (
      attributeName === 'v-html'
      || attributeName.startsWith('v-html:')
      || attributeName.startsWith('v-html.')
    ) {
      offsets.push(nameStart);
    }
    while (cursor < tag.attributesEnd && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] !== '=') continue;
    cursor += 1;
    while (cursor < tag.attributesEnd && /\s/.test(source[cursor])) cursor += 1;
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      cursor += 1;
      while (cursor < tag.attributesEnd) {
        if (source[cursor] === '\\') {
          cursor += 2;
        } else if (source[cursor] === quote) {
          cursor += 1;
          break;
        } else {
          cursor += 1;
        }
      }
    } else {
      while (cursor < tag.attributesEnd && !/\s/.test(source[cursor])) cursor += 1;
    }
  }
  return offsets;
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function sourceLocation(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return { line: high + 1, column: offset - starts[high] + 1 };
}

function scanTemplate(source, openingTag, relativePath, starts) {
  const findings = vHtmlAttributeOffsets(source, openingTag).map((offset) => ({
    ...sourceLocation(starts, offset),
    offset,
    path: relativePath,
    rule: VUE_NO_V_HTML_RULE,
  }));
  let depth = 1;
  let cursor = openingTag.end;
  while (cursor < source.length && depth > 0) {
    const tagStart = source.indexOf('<', cursor);
    const mustacheStart = source.indexOf('{{', cursor);
    if (mustacheStart !== -1 && (tagStart === -1 || mustacheStart < tagStart)) {
      cursor = skipMustache(source, mustacheStart);
      continue;
    }
    if (tagStart === -1) break;
    const tag = readTag(source, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    cursor = tag.end;
    if (tag.type === 'comment') continue;
    if (tag.name === 'template') {
      if (tag.closing) depth -= 1;
      else if (!tag.selfClosing) depth += 1;
    }
    if (!tag.closing && depth > 0) {
      for (const offset of vHtmlAttributeOffsets(source, tag)) {
        findings.push({
          ...sourceLocation(starts, offset),
          offset,
          path: relativePath,
          rule: VUE_NO_V_HTML_RULE,
        });
      }
    }
  }
  return { cursor, findings };
}

export function findVueVHtml(source, relativePath = 'component.vue') {
  const starts = lineStarts(source);
  let cursor = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf('<', cursor);
    if (tagStart === -1) break;
    const tag = readTag(source, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    cursor = tag.end;
    if (tag.type === 'comment' || tag.closing) continue;
    if (tag.name === 'template') {
      const result = scanTemplate(source, tag, relativePath, starts);
      return result.findings;
    }
    if (!tag.selfClosing) cursor = findRawClosingTag(source, tag.name, tag.end);
  }
  return [];
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

export function buildUnsafeVueHtmlAiInstructions(violations) {
  const lines = ['Vue v-html 安全门禁失败，可将以下指令分别交给 AI 修复：'];
  violations.forEach((violation, index) => {
    lines.push(
      '',
      `${index + 1}. 请移除 ${violation.path} 第 ${violation.line} 行第 ${violation.column} 列的 v-html。`,
      `   规则：${violation.rule}`,
      '   修复要求：优先使用 Vue 模板、组件、插值或 textContent，以结构化方式渲染内容。',
      '   富文本要求：如果业务确实需要 HTML，必须先建立可信来源和严格消毒边界，并由有权人员审查风险。',
      '   禁止绕过：AI 不得新增、延期或修改结构化例外，不得关闭门禁、改扩展名或使用等价动态 HTML 注入方式。',
      '   验证要求：确认页面展示、交互和可访问性保持正确，并运行项目已有的 lint、测试和构建命令。',
    );
  });
  lines.push('', `共 ${violations.length} 处未经批准的 v-html，提交已停止。`);
  return lines.join('\n');
}

function reportApproved(approved) {
  for (const finding of approved) {
    console.warn(
      `Vue v-html approved exception: ${finding.path}:${finding.line}:${finding.column} `
      + `(${finding.exception.id}, expires=${finding.exception.expiresOn}).`,
    );
  }
}

export function runUnsafeVueHtmlFiles({ root, files, exceptions }) {
  const result = inspectUnsafeVueHtml({ root, files, exceptions });
  reportApproved(result.approved);
  if (result.violations.length > 0) {
    console.error(buildUnsafeVueHtmlAiInstructions(result.violations));
    return 1;
  }
  console.log(
    `Vue v-html gate passed: ${result.checkedCount} file(s), `
    + `${result.approved.length} approved exception(s).`,
  );
  return 0;
}

export function runUnsafeVueHtmlProject({ root, exceptions }) {
  const files = collectProjectFiles(root);
  return runUnsafeVueHtmlFiles({ root, files, exceptions });
}
