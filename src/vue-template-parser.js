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
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
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
  const match = findRawClosingTagMatch(source, name, from);
  return match ? match.end : source.length;
}

function findRawClosingTagMatch(source, name, from) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`</${escapedName}\\s*>`, 'gi');
  expression.lastIndex = from;
  const match = expression.exec(source);
  return match ? { end: expression.lastIndex, start: match.index } : null;
}

function skipMustache(source, start) {
  let cursor = start + 2;
  let quote = null;
  let escaped = false;
  while (cursor < source.length - 1) {
    const character = source[cursor];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '}' && source[cursor + 1] === '}') {
      return cursor + 2;
    }
    cursor += 1;
  }
  return source.length;
}

function tagAttributes(source, tag) {
  if (tag.closing) return [];
  const attributes = [];
  let cursor = tag.attributesStart;
  while (cursor < tag.attributesEnd) {
    while (cursor < tag.attributesEnd && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] === '/') {
      cursor += 1;
      continue;
    }
    const nameStart = cursor;
    while (cursor < tag.attributesEnd && !/[\s=>]/.test(source[cursor])) cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = source.slice(nameStart, cursor).toLowerCase();
    while (cursor < tag.attributesEnd && /\s/.test(source[cursor])) cursor += 1;
    let value = null;
    let valueOffset = null;
    if (source[cursor] === '=') {
      cursor += 1;
      while (cursor < tag.attributesEnd && /\s/.test(source[cursor])) cursor += 1;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        valueOffset = cursor;
        const valueStart = cursor;
        while (cursor < tag.attributesEnd) {
          if (source[cursor] === '\\') cursor += 2;
          else if (source[cursor] === quote) break;
          else cursor += 1;
        }
        value = source.slice(valueStart, cursor);
        if (source[cursor] === quote) cursor += 1;
      } else {
        valueOffset = cursor;
        const valueStart = cursor;
        while (cursor < tag.attributesEnd && !/\s/.test(source[cursor])) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
    }
    attributes.push({
      name,
      offset: nameStart,
      tagName: tag.name,
      tagStart: tag.start,
      value,
      valueOffset,
    });
  }
  return attributes;
}

function scanTemplate(source, openingTag) {
  const attributes = [...tagAttributes(source, openingTag)];
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
    if (!tag.closing && depth > 0) attributes.push(...tagAttributes(source, tag));
  }
  return attributes;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

function findRootTemplateOpening(source) {
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
    if (tag.name === 'template') return tag;
    if (!tag.selfClosing) cursor = findRawClosingTag(source, tag.name, tag.end);
  }
  return null;
}

function scanTemplateElements(source, openingTag) {
  const root = {
    end: openingTag.end,
    name: openingTag.name,
    parentStart: null,
    start: openingTag.start,
  };
  const elements = [];
  const stack = [root];
  let cursor = openingTag.end;

  while (cursor < source.length && stack.length > 0) {
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

    if (tag.closing) {
      const matchingIndex = stack.findLastIndex(({ name }) => name === tag.name);
      if (matchingIndex !== -1) {
        stack[matchingIndex].closingEnd = tag.end;
        stack[matchingIndex].contentEnd = tag.start;
        stack.splice(matchingIndex);
      }
      continue;
    }

    const parent = stack.at(-1);
    const element = {
      attributes: tagAttributes(source, tag),
      contentEnd: tag.end,
      end: tag.end,
      name: tag.name,
      parentStart: parent?.start ?? null,
      selfClosing: tag.selfClosing || VOID_ELEMENTS.has(tag.name),
      start: tag.start,
    };
    elements.push(element);
    if (RAW_TEXT_ELEMENTS.has(element.name) && !element.selfClosing) {
      const closing = findRawClosingTagMatch(source, element.name, element.end);
      element.contentEnd = closing?.start ?? source.length;
      element.closingEnd = closing?.end ?? source.length;
      cursor = closing?.end ?? source.length;
    } else if (!element.selfClosing) {
      stack.push(element);
    }
  }

  return elements;
}

export function findVueTemplateAttributes(source) {
  const openingTag = findRootTemplateOpening(source);
  return openingTag ? scanTemplate(source, openingTag) : [];
}

export function findVueTemplateElements(source) {
  const openingTag = findRootTemplateOpening(source);
  return openingTag ? scanTemplateElements(source, openingTag) : [];
}

export function sourceLocation(source, offset) {
  const before = source.slice(0, offset);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: offset - lastNewline,
  };
}
