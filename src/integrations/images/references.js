import path from 'node:path';
import { parse, parseExpression } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { executionError } from '../../core/error/repo-guard-error.js';
import {
  findVueScriptBlocks,
  findVueStyleBlocks,
  findVueTemplateAttributes,
} from '../vue/template-parser.js';

const traverse = traverseModule.default ?? traverseModule;
const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const STYLE_EXTENSIONS = new Set(['.css', '.less', '.scss', '.sass', '.wxss']);
const MARKUP_EXTENSIONS = new Set(['.html', '.wxml']);
const REFERENCE_ATTRIBUTES = new Set([
  'src', 'poster', 'srcset', 'href', 'xlink:href',
  ':src', 'v-bind:src', ':srcset', 'v-bind:srcset', ':poster', 'v-bind:poster',
  ':href', 'v-bind:href',
]);

function parserPlugins(relativePath, language = '') {
  const typescript = /^(?:ts|tsx)$/.test(language) || /\.(?:cts|mts|ts|tsx)$/i.test(relativePath);
  const jsx = /^(?:jsx|tsx)$/.test(language) || /\.(?:jsx|tsx)$/i.test(relativePath);
  return [
    ...(typescript ? ['typescript'] : []),
    ...(jsx ? ['jsx'] : []),
    'decorators-legacy',
    'importAttributes',
  ];
}

function parseScript(source, relativePath, language = '') {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      plugins: parserPlugins(relativePath, language),
      sourceType: 'unambiguous',
    });
  } catch (error) {
    const location = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : '';
    throw executionError(
      'unused-image-assets/source-parse-failed',
      `无效图片资源门禁无法解析 ${relativePath}${location}：${error.reasonCode ?? error.message}`,
      { cause: error, details: { location: { path: relativePath } } },
    );
  }
}

function staticTemplateValue(node) {
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? null;
  }
  return null;
}

function scriptReferences(source, relativePath, language = '', offsetBase = 0) {
  const ast = parseScript(source, relativePath, language);
  const references = [];
  const dynamicGlobs = [];
  const addReference = (value, offset, kind = 'script-string') => {
    if (typeof value === 'string') references.push({ value, offset: offsetBase + offset, kind });
  };
  traverse(ast, {
    StringLiteral(nodePath) {
      addReference(nodePath.node.value, nodePath.node.start);
    },
    TemplateLiteral(nodePath) {
      const value = staticTemplateValue(nodePath.node);
      if (value != null) addReference(value, nodePath.node.start, 'script-template');
    },
    CallExpression(callPath) {
      const callee = callPath.node.callee;
      const isGlob = callee?.type === 'MemberExpression'
        && !callee.computed
        && callee.property?.type === 'Identifier'
        && callee.property.name === 'glob'
        && callee.object?.type === 'MetaProperty'
        && callee.object.meta?.name === 'import'
        && callee.object.property?.name === 'meta';
      if (!isGlob) return;
      const argument = callPath.node.arguments[0];
      const values = argument?.type === 'ArrayExpression'
        ? argument.elements
        : [argument];
      for (const valueNode of values) {
        const value = valueNode?.type === 'StringLiteral'
          ? valueNode.value
          : staticTemplateValue(valueNode);
        if (value != null) dynamicGlobs.push({ value, offset: offsetBase + valueNode.start });
      }
    },
  });
  return { dynamicGlobs, references };
}

function splitSrcset(value) {
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

function quotedExpression(value) {
  const match = value?.trim().match(/^(?:'([^']+)'|"([^"]+)"|`([^`]+)`)$/s);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

function boundExpressionStrings(value) {
  try {
    const expression = parseExpression(value, { plugins: ['typescript', 'jsx'] });
    const strings = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'StringLiteral') {
        strings.push(node.value);
        return;
      }
      const templateValue = staticTemplateValue(node);
      if (templateValue != null) {
        strings.push(templateValue);
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'extra', 'comments', 'errors'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    visit(expression);
    return strings;
  } catch {
    return [];
  }
}

function referencesFromAttributes(attributes) {
  return attributes.flatMap((attribute) => {
    if (!REFERENCE_ATTRIBUTES.has(attribute.name) || attribute.value == null) return [];
    const bound = attribute.name.startsWith(':') || attribute.name.startsWith('v-bind:');
    const direct = bound ? quotedExpression(attribute.value) : attribute.value;
    const candidates = direct == null
      ? boundExpressionStrings(attribute.value)
      : [direct];
    const values = attribute.name.includes('srcset')
      ? candidates.flatMap(splitSrcset)
      : candidates;
    return values.map((entry) => ({
      value: entry,
      offset: attribute.valueOffset ?? attribute.offset,
      kind: 'markup-attribute',
    }));
  });
}

function markupReferences(source) {
  const inspectedSource = source.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
  const attributes = [];
  const tagPattern = /<([A-Za-z][\w:.-]*)(?:\s+([^<>]*?))?\s*\/?>/gs;
  let tagMatch;
  while ((tagMatch = tagPattern.exec(inspectedSource))) {
    const rawAttributes = tagMatch[2] ?? '';
    const attributesOffset = tagMatch.index + tagMatch[0].indexOf(rawAttributes);
    const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attributeMatch;
    while ((attributeMatch = attributePattern.exec(rawAttributes))) {
      const value = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4];
      attributes.push({
        name: attributeMatch[1].toLowerCase(),
        offset: attributesOffset + attributeMatch.index,
        value,
        valueOffset: attributesOffset + attributeMatch.index + attributeMatch[0].indexOf(value),
      });
    }
  }
  return referencesFromAttributes(attributes);
}

function styleReferences(source, offsetBase = 0) {
  const inspectedSource = source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))
    .replace(/(^|\n)\s*\/\/[^\r\n]*/g, (comment) => ' '.repeat(comment.length));
  const references = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi;
  let match;
  while ((match = pattern.exec(inspectedSource))) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (value) references.push({ value, offset: offsetBase + match.index, kind: 'style-url' });
  }
  return references;
}

function htmlReferences(source, relativePath) {
  const markupSource = source.replace(
    /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    (block, _kind, _attributes, content) => block.replace(content, ' '.repeat(content.length)),
  );
  const references = markupReferences(markupSource);
  const dynamicGlobs = [];
  const blockPattern = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  while ((match = blockPattern.exec(source))) {
    const kind = match[1].toLowerCase();
    const content = match[3];
    const contentOffset = match.index + match[0].indexOf(content);
    if (kind === 'style') {
      references.push(...styleReferences(content, contentOffset));
      continue;
    }
    const type = match[2].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const facts = scriptReferences(content, relativePath, '', contentOffset);
    references.push(...facts.references);
    dynamicGlobs.push(...facts.dynamicGlobs);
  }
  return { dynamicGlobs, references };
}

function markdownReferences(source) {
  const withoutCode = source
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\r\n]*`/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const references = markupReferences(withoutCode);
  const pattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  let match;
  while ((match = pattern.exec(withoutCode))) {
    references.push({ value: match[1] ?? match[2], offset: match.index, kind: 'markdown-image' });
  }
  return references;
}

function jsonReferences(source, relativePath) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw executionError(
      'unused-image-assets/source-parse-failed',
      `无效图片资源门禁无法解析 ${relativePath}：${error.message}`,
      { cause: error, details: { location: { path: relativePath } } },
    );
  }
  const references = [];
  const visit = (candidate) => {
    if (typeof candidate === 'string') references.push({ value: candidate, offset: 0, kind: 'json-string' });
    else if (Array.isArray(candidate)) candidate.forEach(visit);
    else if (candidate && typeof candidate === 'object') Object.values(candidate).forEach(visit);
  };
  visit(value);
  return references;
}

function vueReferences(source, relativePath) {
  const scriptFacts = findVueScriptBlocks(source)
    .filter((block) => !block.attributes.some(({ name }) => name === 'src'))
    .map((block) => scriptReferences(
      source.slice(block.contentStart, block.contentEnd),
      relativePath,
      block.attributes.find(({ name }) => name === 'lang')?.value?.toLowerCase() ?? '',
      block.contentStart,
    ));
  return {
    references: [
      ...referencesFromAttributes(findVueTemplateAttributes(source)),
      ...scriptFacts.flatMap(({ references }) => references),
      ...findVueStyleBlocks(source).flatMap((block) => styleReferences(
        source.slice(block.contentStart, block.contentEnd),
        block.contentStart,
      )),
    ],
    dynamicGlobs: scriptFacts.flatMap(({ dynamicGlobs }) => dynamicGlobs),
  };
}

export function extractImageReferenceFacts(source, relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (extension === '.vue' || extension === '.nvue') return vueReferences(source, relativePath);
  if (SCRIPT_EXTENSIONS.has(extension)) return scriptReferences(source, relativePath);
  if (STYLE_EXTENSIONS.has(extension)) return { references: styleReferences(source), dynamicGlobs: [] };
  if (MARKUP_EXTENSIONS.has(extension)) return htmlReferences(source, relativePath);
  if (extension === '.md') return { references: markdownReferences(source), dynamicGlobs: [] };
  if (extension === '.json') return { references: jsonReferences(source, relativePath), dynamicGlobs: [] };
  return { references: [], dynamicGlobs: [] };
}
