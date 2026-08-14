const TEST_API_BASE_PATTERN = /(?<![\w$.])\b(describe|it|test)\b/g;
const DISABLED_TEST_PROPERTIES = new Set(['only', 'skip', 'skipIf', 'todo']);
const EXECUTING_TEST_PROPERTIES = new Set([
  'concurrent',
  'each',
  'fails',
  'for',
  'runIf',
  'sequential',
]);

function previousNonWhitespace(value) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(value[index])) {
      return value[index];
    }
  }
  return '';
}

function masksRegexLiteral(output) {
  const previous = previousNonWhitespace(output);
  if (!previous || /[([{:,;=!?&|+\-*%^~<>]/.test(previous)) {
    return true;
  }
  let index = output.length - 1;
  while (index >= 0 && /\s/.test(output[index])) {
    index -= 1;
  }
  let word = '';
  while (index >= 0 && /[\w$]/.test(output[index])) {
    word = output[index] + word;
    index -= 1;
  }
  return new Set([
    'await',
    'case',
    'delete',
    'in',
    'instanceof',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]).has(word);
}

function maskNonCode(content) {
  const output = [];
  let state = 'code';
  let stringQuote = '';
  let inCharacterClass = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    const masked = character === '\n' || character === '\r' ? character : ' ';

    if (state === 'line-comment') {
      output.push(masked);
      if (character === '\n') {
        state = 'code';
      }
      continue;
    }
    if (state === 'block-comment') {
      output.push(masked);
      if (character === '*' && next === '/') {
        output.push(' ');
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'string' || state === 'template') {
      output.push(masked);
      if (character === '\\') {
        if (next != null) {
          output.push(next === '\n' || next === '\r' ? next : ' ');
          index += 1;
        }
        continue;
      }
      if (
        (state === 'string' && character === stringQuote)
        || (state === 'template' && character === '`')
      ) {
        state = 'code';
      }
      continue;
    }
    if (state === 'regex') {
      output.push(masked);
      if (character === '\\') {
        if (next != null) {
          output.push(' ');
          index += 1;
        }
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
      } else if (character === ']') {
        inCharacterClass = false;
      } else if (character === '/' && !inCharacterClass) {
        state = 'regex-flags';
      }
      continue;
    }
    if (state === 'regex-flags') {
      if (/[A-Za-z]/.test(character)) {
        output.push(' ');
        continue;
      }
      state = 'code';
    }

    if (character === '/' && next === '/') {
      output.push(' ', ' ');
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      output.push(' ', ' ');
      index += 1;
      state = 'block-comment';
    } else if (character === '/' && masksRegexLiteral(output)) {
      output.push(' ');
      state = 'regex';
      inCharacterClass = false;
    } else if (character === "'" || character === '"') {
      output.push(' ');
      state = 'string';
      stringQuote = character;
    } else if (character === '`') {
      output.push(' ');
      state = 'template';
    } else {
      output.push(character);
    }
  }

  return output.join('');
}

export function analyzeUnitTestContent(content) {
  const code = maskNonCode(content);
  const bypasses = [];
  let hasTestCase = false;

  for (const match of code.matchAll(TEST_API_BASE_PATTERN)) {
    const base = match[1];
    const properties = [];
    let cursor = match.index + match[0].length;
    let hasCall = false;

    while (cursor < code.length) {
      while (cursor < code.length && /\s/.test(code[cursor])) {
        cursor += 1;
      }
      if (code[cursor] === '.') {
        cursor += 1;
        while (cursor < code.length && /\s/.test(code[cursor])) {
          cursor += 1;
        }
        const propertyStart = cursor;
        if (cursor >= code.length || !/[A-Za-z_$]/.test(code[cursor])) {
          break;
        }
        cursor += 1;
        while (cursor < code.length && /[\w$]/.test(code[cursor])) {
          cursor += 1;
        }
        properties.push({
          index: propertyStart,
          name: code.slice(propertyStart, cursor),
        });
        continue;
      }
      if (code[cursor] === '(') {
        hasCall = true;
        let depth = 1;
        cursor += 1;
        while (cursor < code.length && depth > 0) {
          if (code[cursor] === '(') {
            depth += 1;
          } else if (code[cursor] === ')') {
            depth -= 1;
          }
          cursor += 1;
        }
        continue;
      }
      break;
    }

    if (!hasCall) {
      continue;
    }
    const knownProperties = properties.every(({ name }) => (
      EXECUTING_TEST_PROPERTIES.has(name)
      || DISABLED_TEST_PROPERTIES.has(name)
    ));
    if (base !== 'describe' && knownProperties) {
      hasTestCase = true;
    }
    for (const property of properties) {
      if (!DISABLED_TEST_PROPERTIES.has(property.name)) {
        continue;
      }
      const line = code.slice(0, property.index).split(/\r?\n/).length;
      bypasses.push({ line, expression: `${base}.${property.name}` });
    }
  }

  return { bypasses, hasTestCase };
}
