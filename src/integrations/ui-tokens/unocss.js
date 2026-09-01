import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseExpression } from '@babel/parser';
import {
  findMarkupAttributes,
  findVueScriptBlocks,
  findVueTemplateAttributes,
  sourceLocation,
} from '../vue/template-parser.js';

function relativeFile(root, file) {
  const absolute = typeof file === 'string'
    ? (path.isAbsolute(file) ? file : path.join(root, file))
    : file.absolute;
  const relative = typeof file === 'string'
    ? (path.isAbsolute(file) ? path.relative(root, file) : file).replaceAll('\\', '/')
    : file.relative;
  return { absolute, relative };
}

function splitTopLevelWhitespace(value) {
  const tokens = [];
  let current = '';
  let roundDepth = 0;
  let squareDepth = 0;
  for (const character of value) {
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth -= 1;
    if (/\s/.test(character) && roundDepth === 0 && squareDepth === 0) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function closingParenthesis(value, opening) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let index = opening + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['\'', '"'].includes(character)) quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function expandVariantGroups(value) {
  let squareDepth = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    if (character !== ':' || value[index + 1] !== '(' || squareDepth !== 0) continue;
    let prefixStart = index - 1;
    while (prefixStart >= 0 && !/\s/.test(value[prefixStart])) prefixStart -= 1;
    prefixStart += 1;
    const prefix = value.slice(prefixStart, index);
    const closing = closingParenthesis(value, index + 1);
    if (!prefix || closing === -1) continue;
    const body = expandVariantGroups(value.slice(index + 2, closing));
    const replacement = splitTopLevelWhitespace(body)
      .map((token) => `${prefix}:${token}`)
      .join(' ');
    return expandVariantGroups(
      `${value.slice(0, prefixStart)}${replacement}${value.slice(closing + 1)}`,
    );
  }
  return value;
}

function classFacts(source, value, offset, pathName, tagName, variantGroups) {
  const expanded = variantGroups ? expandVariantGroups(value) : value;
  return splitTopLevelWhitespace(expanded)
    .filter((token) => token && !token.endsWith('-'))
    .map((token) => {
      const tokenOffset = source.indexOf(token.split(':').at(-1), offset);
      return {
        type: 'utility',
        token,
        tagName,
        path: pathName,
        ...sourceLocation(source, tokenOffset < 0 ? offset : tokenOffset),
      };
    });
}

function unwrapClassExpression(node) {
  let current = node;
  while ([
    'ParenthesizedExpression',
    'TSAsExpression',
    'TSNonNullExpression',
    'TSSatisfiesExpression',
    'TypeCastExpression',
  ].includes(current?.type)) {
    current = current.expression;
  }
  return current;
}

function mergeClassAnalyses(analyses) {
  return {
    dynamic: analyses.some(({ dynamic }) => dynamic),
    opaque: analyses.some(({ opaque }) => opaque),
    values: analyses.flatMap(({ values }) => values),
  };
}

function hasBoundedClassPrefix(prefix) {
  const currentToken = prefix.split(/\s/).at(-1) ?? '';
  if (/^\[[a-z-]+:$/i.test(currentToken)) return true;
  const base = currentToken.split(':').at(-1);
  return /^-?[a-z][a-z0-9-]*-$/i.test(base);
}

function boundedTemplatePrefix(node) {
  return hasBoundedClassPrefix(node.quasis[0]?.value.raw ?? '');
}

function staticObjectKey(property) {
  if (!property.computed && property.key?.type === 'Identifier') return property.key.name;
  const key = unwrapClassExpression(property.key);
  if (key?.type === 'StringLiteral') return key.value;
  if (key?.type === 'NumericLiteral') return String(key.value);
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? key.quasis[0]?.value.raw ?? '';
  }
  return null;
}

function classExpressionAnalysis(node) {
  const current = unwrapClassExpression(node);
  if (!current) return { dynamic: false, opaque: false, values: [] };
  if (current.type === 'StringLiteral') {
    return { dynamic: false, opaque: false, values: [current.value] };
  }
  if (current.type === 'TemplateLiteral') {
    if (current.expressions.length === 0) {
      return {
        dynamic: false,
        opaque: false,
        values: [current.quasis[0]?.value.cooked ?? current.quasis[0]?.value.raw ?? ''],
      };
    }
    return {
      dynamic: true,
      opaque: !boundedTemplatePrefix(current),
      values: [],
    };
  }
  if (current.type === 'ConditionalExpression') {
    return mergeClassAnalyses([
      classExpressionAnalysis(current.consequent),
      classExpressionAnalysis(current.alternate),
    ]);
  }
  if (current.type === 'LogicalExpression' && current.operator === '&&') {
    return classExpressionAnalysis(current.right);
  }
  if (current.type === 'ArrayExpression') {
    return mergeClassAnalyses(current.elements.map((element) => (
      element?.type === 'SpreadElement'
        ? { dynamic: true, opaque: true, values: [] }
        : classExpressionAnalysis(element)
    )));
  }
  if (current.type === 'ObjectExpression') {
    const analyses = current.properties.map((property) => {
      if (!['ObjectProperty', 'ObjectMethod'].includes(property.type)) {
        return { dynamic: true, opaque: true, values: [] };
      }
      const key = staticObjectKey(property);
      return key === null
        ? { dynamic: true, opaque: true, values: [] }
        : { dynamic: false, opaque: false, values: [key] };
    });
    return mergeClassAnalyses(analyses);
  }
  if (current.type === 'BinaryExpression' && current.operator === '+') {
    let left = unwrapClassExpression(current.left);
    while (left?.type === 'BinaryExpression' && left.operator === '+') {
      left = unwrapClassExpression(left.left);
    }
    const prefix = left?.type === 'StringLiteral' ? left.value : '';
    const currentToken = prefix.split(/\s/).at(-1) ?? '';
    return {
      dynamic: true,
      opaque: !hasBoundedClassPrefix(currentToken),
      values: [],
    };
  }
  if (['BooleanLiteral', 'NullLiteral', 'NumericLiteral'].includes(current.type)) {
    return { dynamic: false, opaque: false, values: [] };
  }
  if (current.type === 'UnaryExpression') {
    return { dynamic: false, opaque: false, values: [] };
  }
  return { dynamic: true, opaque: true, values: [] };
}

function quotedClassFacts(source, value, offset, pathName, tagName, variantGroups) {
  let analysis;
  try {
    analysis = classExpressionAnalysis(parseExpression(value, { plugins: ['typescript'] }));
  } catch {
    analysis = { dynamic: true, opaque: true, values: [] };
  }
  const facts = analysis.values.flatMap((staticValue) => classFacts(
    source,
    staticValue,
    offset,
    pathName,
    tagName,
    variantGroups,
  ));
  if (analysis.dynamic) {
    facts.push({
      type: 'dynamic',
      value,
      opaque: analysis.opaque,
      tagName,
      path: pathName,
      ...sourceLocation(source, offset),
    });
  }
  return facts;
}

function jsxTagName(node) {
  if (node?.type === 'JSXIdentifier') return node.name;
  if (node?.type === 'JSXMemberExpression') return jsxTagName(node.property);
  if (node?.type === 'JSXNamespacedName') return jsxTagName(node.name);
  return null;
}

function jsxClassFacts(source, pathName, config) {
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
    });
  } catch (error) {
    return [{
      type: 'dynamic',
      value: `JSX 无法静态解析：${error.message}`,
      opaque: true,
      path: pathName,
      line: 1,
      column: 1,
    }];
  }
  const facts = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement') {
      const tagName = jsxTagName(node.name);
      for (const attribute of node.attributes) {
        if (attribute.type !== 'JSXAttribute') continue;
        const name = jsxTagName(attribute.name)?.toLowerCase();
        if (!['class', 'classname'].includes(name)) continue;
        const expression = attribute.value?.type === 'JSXExpressionContainer'
          ? attribute.value.expression
          : attribute.value;
        const analysis = classExpressionAnalysis(expression);
        const offset = attribute.value?.start ?? attribute.start ?? 0;
        facts.push(...analysis.values.flatMap((staticValue) => classFacts(
          source,
          staticValue,
          offset,
          pathName,
          tagName,
          config.variantGroups,
        )));
        if (analysis.dynamic) {
          facts.push({
            type: 'dynamic',
            value: source.slice(expression?.start ?? offset, expression?.end ?? offset),
            opaque: analysis.opaque,
            tagName,
            path: pathName,
            ...sourceLocation(source, offset),
          });
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value);
    }
  };
  visit(ast.program);
  return facts;
}

function attributifyFact(source, attribute, pathName) {
  return {
    type: 'attributify',
    name: attribute.name,
    value: attribute.value ?? '',
    tagName: attribute.tagName,
    path: pathName,
    ...sourceLocation(source, attribute.valueOffset ?? attribute.offset),
  };
}

function attributeFacts(source, pathName, config, attributes, { vue = false } = {}) {
  return attributes.flatMap((attribute) => {
    if (['class', 'classname'].includes(attribute.name)) {
      return classFacts(
        source,
        attribute.value ?? '',
        attribute.valueOffset ?? attribute.offset,
        pathName,
        attribute.tagName,
        config.variantGroups,
      );
    }
    if (vue && [':class', 'v-bind:class'].includes(attribute.name)) {
      return quotedClassFacts(
        source,
        attribute.value ?? '',
        attribute.valueOffset ?? attribute.offset,
        pathName,
        attribute.tagName,
        config.variantGroups,
      );
    }
    return config.attributify ? [attributifyFact(source, attribute, pathName)] : [];
  });
}

function vueFacts(source, pathName, config) {
  return attributeFacts(
    source,
    pathName,
    config,
    findVueTemplateAttributes(source),
    { vue: true },
  );
}

function markupFacts(source, pathName, config) {
  const facts = attributeFacts(source, pathName, config, findMarkupAttributes(source));
  const dynamicTemplate = /\b(?:class|className)\s*=\s*\{?`([^`]*)`\}?/g;
  let match;
  while ((match = dynamicTemplate.exec(source)) !== null) {
    facts.push(...classFacts(
      source,
      match[1].replace(/\$\{[^}]*\}/g, ''),
      match.index,
      pathName,
      null,
      config.variantGroups,
    ));
    if (match[1].includes('${')) {
      facts.push({
        type: 'dynamic',
        value: match[1],
        path: pathName,
        ...sourceLocation(source, match.index),
      });
    }
  }
  return facts;
}

function scriptStringFacts(
  source,
  pathName,
  config,
  { baseOffset = 0, fullSource = source } = {},
) {
  const facts = [];
  const quoted = /(['"])((?:\\.|(?!\1).)*)\1/g;
  let match;
  while ((match = quoted.exec(source)) !== null) {
    facts.push(...classFacts(
      fullSource,
      match[2],
      baseOffset + match.index + 1,
      pathName,
      null,
      config.variantGroups,
    ));
  }
  const template = /`((?:\\.|[^`])*)`/g;
  while ((match = template.exec(source)) !== null) {
    const staticValue = match[1].replace(/\$\{[^}]*\}/g, '');
    facts.push(...classFacts(
      fullSource,
      staticValue,
      baseOffset + match.index + 1,
      pathName,
      null,
      config.variantGroups,
    ));
    if (match[1].includes('${')) {
      facts.push({
        type: 'dynamic',
        value: match[1],
        path: pathName,
        ...sourceLocation(fullSource, baseOffset + match.index),
      });
    }
  }
  const concatenation = /(['"])([^'"\r\n]*-)\1\s*\+/g;
  while ((match = concatenation.exec(source)) !== null) {
    facts.push({
      type: 'dynamic',
      value: match[0],
      path: pathName,
      ...sourceLocation(fullSource, baseOffset + match.index),
    });
  }
  return facts;
}

function uniqueFacts(facts) {
  const seen = new Set();
  return facts.filter((fact) => {
    const identity = [
      fact.type,
      fact.path,
      fact.line,
      fact.column,
      fact.token ?? fact.name ?? fact.value,
    ].join(':');
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function collectUnoCssFacts({ root, files, config }) {
  return Object.freeze(files.flatMap((file) => {
    const resolved = relativeFile(root, file);
    const source = readFileSync(resolved.absolute, 'utf8');
    const structuralFacts = resolved.relative.toLowerCase().endsWith('.vue')
      ? vueFacts(source, resolved.relative, config)
      : markupFacts(source, resolved.relative, config);
    const scriptFacts = resolved.relative.toLowerCase().endsWith('.vue')
      ? findVueScriptBlocks(source).flatMap(({ contentEnd, contentStart }) => scriptStringFacts(
        source.slice(contentStart, contentEnd),
        resolved.relative,
        config,
        { baseOffset: contentStart, fullSource: source },
      ))
      : scriptStringFacts(source, resolved.relative, config);
    const jsxFacts = /\.(?:jsx|tsx)$/i.test(resolved.relative)
      ? jsxClassFacts(source, resolved.relative, config)
      : [];
    const facts = uniqueFacts([
      ...structuralFacts,
      ...jsxFacts,
      ...scriptFacts,
    ]);
    return facts.map((fact) => Object.freeze(fact));
  }));
}
