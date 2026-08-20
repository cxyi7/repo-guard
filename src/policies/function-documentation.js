import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import micromatch from 'micromatch';
import { executionError } from '../core/error/repo-guard-error.js';
import { findVueScriptBlocks } from '../integrations/vue/template-parser.js';

const traverse = traverseModule.default ?? traverseModule;
const PARAM_TAGS = new Set(['param', 'arg', 'argument']);
const RETURN_TAGS = new Set(['return', 'returns']);
const THROWS_TAGS = new Set(['throws', 'exception']);
const TRANSPARENT_RETURN_WRAPPERS = new Set([
  'AwaitExpression',
  'TSAsExpression',
  'TSInstantiationExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TypeCastExpression',
]);

function matchesAny(filePath, patterns) {
  return patterns.length > 0 && micromatch.isMatch(filePath, patterns, { dot: true });
}

export function selectFunctionDocumentationFiles(files, config) {
  if (!config.enabled) return [];
  const extensions = new Set(config.extensions);
  return files
    .filter(({ relative }) => extensions.has(path.extname(relative).toLowerCase()))
    .filter(({ relative }) => matchesAny(relative, config.include))
    .filter(({ relative }) => !matchesAny(relative, config.exclude))
    .map(({ absolute }) => absolute);
}

function parserPlugins(relativePath, language = '') {
  const typescript = /^(?:ts|tsx)$/.test(language)
    || /\.(?:cts|mts|ts|tsx)$/i.test(relativePath);
  const jsx = /^(?:jsx|tsx)$/.test(language) || /\.(?:jsx|tsx)$/i.test(relativePath);
  return [
    ...(typescript ? ['typescript'] : []),
    ...(jsx ? ['jsx'] : []),
    'decorators-legacy',
    'importAttributes',
  ];
}

function parseProgram(source, relativePath, language, lineOffset) {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      attachComment: true,
      plugins: parserPlugins(relativePath, language),
      sourceType: 'unambiguous',
    });
  } catch (error) {
    const line = error.loc ? error.loc.line + lineOffset : null;
    const column = error.loc ? error.loc.column + 1 : null;
    const location = line == null ? '' : `:${line}:${column}`;
    throw executionError(
      'function-docs/source-parse-failed',
      `函数文档同步无法解析 ${relativePath}${location}：${error.reasonCode ?? error.message}`,
      {
        cause: error,
        details: { location: { path: relativePath, line, column } },
      },
    );
  }
}

function keyName(node) {
  const key = node.key;
  if (node.kind === 'constructor') return 'constructor';
  if (key?.type === 'Identifier' || key?.type === 'PrivateName') {
    const name = key.type === 'PrivateName' ? key.id?.name : key.name;
    return key.type === 'PrivateName' ? `#${name}` : name;
  }
  if (key?.type === 'StringLiteral' || key?.type === 'NumericLiteral') {
    return String(key.value);
  }
  return null;
}

function exportTarget(functionPath) {
  const parent = functionPath.parentPath;
  return parent?.isExportNamedDeclaration?.() || parent?.isExportDefaultDeclaration?.()
    ? parent
    : functionPath;
}

function functionTarget(functionPath) {
  const { node } = functionPath;
  if (!node.body) return null;

  if (node.type === 'FunctionDeclaration') {
    return {
      functionPath,
      name: node.id?.name ?? 'default',
      targetPath: exportTarget(functionPath),
    };
  }

  if (['ClassMethod', 'ClassPrivateMethod', 'ObjectMethod'].includes(node.type)) {
    return {
      functionPath,
      name: keyName(node) ?? '匿名方法',
      targetPath: functionPath,
    };
  }

  if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return null;
  const parent = functionPath.parentPath;
  if (parent?.isExportDefaultDeclaration?.()) {
    return { functionPath, name: 'default', targetPath: parent };
  }
  if (parent?.isVariableDeclarator?.()) {
    const declaration = parent.parentPath;
    if (!declaration?.isVariableDeclaration?.()
      || declaration.node.declarations.length !== 1
      || parent.node.id.type !== 'Identifier') {
      return null;
    }
    const targetPath = declaration.parentPath?.isExportNamedDeclaration?.()
      ? declaration.parentPath
      : declaration;
    return { functionPath, name: parent.node.id.name, targetPath };
  }

  if (parent && [
    'ClassProperty',
    'ClassPrivateProperty',
    'ObjectProperty',
  ].includes(parent.node.type)) {
    return {
      functionPath,
      name: keyName(parent.node) ?? '匿名方法',
      targetPath: parent,
    };
  }
  return null;
}

function parameterName(node) {
  if (node.type === 'Identifier') {
    if (node.name === 'this') return { ignored: true };
    return { display: node.name, normalized: node.name };
  }
  if (node.type === 'AssignmentPattern') return parameterName(node.left);
  if (node.type === 'RestElement') {
    const nested = parameterName(node.argument);
    if (!nested || nested.unsupported || nested.ignored) return nested;
    return { display: `...${nested.normalized}`, normalized: nested.normalized };
  }
  if (node.type === 'TSParameterProperty') return parameterName(node.parameter);
  return { unsupported: true };
}

function parametersForFunction(node) {
  const parameters = [];
  let unsupported = false;
  for (const parameter of node.params) {
    const result = parameterName(parameter);
    if (result?.unsupported) unsupported = true;
    else if (result && !result.ignored) parameters.push(result);
  }
  return { parameters, unsupported };
}

function isVoidLikeType(node) {
  if (!node) return false;
  if (['TSVoidKeyword', 'TSNeverKeyword', 'TSUndefinedKeyword'].includes(node.type)) return true;
  if (node.type !== 'TSTypeReference'
    || node.typeName?.type !== 'Identifier'
    || node.typeName.name !== 'Promise') {
    return false;
  }
  const typeArguments = node.typeParameters?.params ?? node.typeArguments?.params ?? [];
  return typeArguments.length === 1 && isVoidLikeType(typeArguments[0]);
}

function returnTypeSignal(node) {
  const annotation = node.returnType?.typeAnnotation;
  if (!annotation) return null;
  return !isVoidLikeType(annotation);
}

function hasReturnValue(functionPath) {
  const { node } = functionPath;
  if (node.generator) return null;
  if (node.kind === 'constructor') return false;
  if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') return true;

  let found = false;
  functionPath.get('body').traverse({
    Function(nestedPath) {
      nestedPath.skip();
    },
    ReturnStatement(returnPath) {
      if (returnPath.node.argument) {
        found = true;
        returnPath.stop();
      }
    },
  });
  return found || (returnTypeSignal(node) ?? false);
}

function isCaughtThrow(throwPath, functionPath) {
  let child = throwPath;
  for (let current = throwPath.parentPath;
    current && current.node !== functionPath.node;
    child = current, current = current.parentPath) {
    if (current.isTryStatement?.()
      && current.node.handler
      && child.node === current.node.block) {
      return true;
    }
  }
  return false;
}

function isPromiseReject(callPath) {
  const callee = callPath.node.callee;
  return callee?.type === 'MemberExpression'
    && !callee.computed
    && callee.object?.type === 'Identifier'
    && callee.object.name === 'Promise'
    && callee.property?.type === 'Identifier'
    && callee.property.name === 'reject'
    && !callPath.scope.hasBinding('Promise', true);
}

function isReturnedExpression(expressionPath, functionPath) {
  let current = expressionPath;
  while (current.parentPath && current.parentPath.node !== functionPath.node) {
    const parent = current.parentPath;
    if (parent.isReturnStatement?.() && parent.node.argument === current.node) return true;
    const conditionalBranch = parent.isConditionalExpression?.()
      && (parent.node.consequent === current.node || parent.node.alternate === current.node);
    const logicalBranch = parent.isLogicalExpression?.()
      && (parent.node.left === current.node || parent.node.right === current.node);
    const finalSequenceValue = parent.isSequenceExpression?.()
      && parent.node.expressions.at(-1) === current.node;
    if (!TRANSPARENT_RETURN_WRAPPERS.has(parent.node.type)
      && !conditionalBranch
      && !logicalBranch
      && !finalSequenceValue) {
      return false;
    }
    current = parent;
  }
  return functionPath.node.type === 'ArrowFunctionExpression'
    && functionPath.node.body === current.node;
}

function hasEscapingException(functionPath) {
  const bodyPath = functionPath.get('body');
  if (functionPath.node.type === 'ArrowFunctionExpression'
    && bodyPath.isCallExpression?.()
    && isPromiseReject(bodyPath)) {
    return true;
  }
  let found = false;
  bodyPath.traverse({
    Function(nestedPath) {
      nestedPath.skip();
    },
    ThrowStatement(throwPath) {
      if (!isCaughtThrow(throwPath, functionPath)) {
        found = true;
        throwPath.stop();
      }
    },
    CallExpression(callPath) {
      if (isPromiseReject(callPath) && isReturnedExpression(callPath, functionPath)) {
        found = true;
        callPath.stop();
      }
    },
  });
  return found;
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

function docContentLines(raw) {
  return trimBlankEdges(raw.slice(3, -2).split(/\r?\n/).map((line) => {
    const star = line.match(/^\s*\*(?:\s?)(.*)$/);
    return (star ? star[1] : line.trim()).trimEnd();
  }));
}

function blockTag(line) {
  return line.match(/^@([A-Za-z][\w-]*)\b/)?.[1]?.toLowerCase() ?? null;
}

function parseDocBlocks(raw) {
  const blocks = [];
  let current = null;
  for (const line of docContentLines(raw)) {
    const tag = blockTag(line);
    if (tag) {
      if (current) blocks.push(current);
      current = { tag, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { tag: null, lines: [line] };
    }
  }
  if (current) blocks.push(current);
  return blocks.map((block) => ({
    ...block,
    lines: trimBlankEdges(block.lines),
  })).filter((block) => block.lines.length > 0);
}

function typeExpressionLength(value) {
  if (!value.startsWith('{')) return 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return 0;
}

function tagRemainder(line) {
  return line.replace(/^@[A-Za-z][\w-]*\b\s*/, '');
}

function normalizedParameterName(value) {
  let name = value.trim();
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
  if (name.startsWith('...')) name = name.slice(3);
  return name.split('=')[0].trim();
}

function documentedParameterName(block) {
  let remainder = tagRemainder(block.lines.join(' '));
  const typeLength = typeExpressionLength(remainder);
  if (typeLength > 0) remainder = remainder.slice(typeLength).trimStart();
  const token = remainder.startsWith('[')
    ? remainder.slice(0, remainder.indexOf(']') + 1)
    : remainder.match(/^\S+/)?.[0];
  return token ? normalizedParameterName(token) : null;
}

function parameterRootName(name) {
  return name.match(/^[^.[]+/)?.[0] ?? name;
}

function stripTypeExpression(line) {
  const tag = line.match(/^(@[A-Za-z][\w-]*\b)\s*/)?.[1];
  if (!tag) return line;
  let remainder = tagRemainder(line);
  const typeLength = typeExpressionLength(remainder);
  if (typeLength === 0) return line;
  remainder = remainder.slice(typeLength).trimStart();
  return remainder ? `${tag} ${remainder}` : tag;
}

function normalizeTypescriptBlock(block) {
  const firstRemainder = tagRemainder(block.lines[0]);
  if (firstRemainder.startsWith('{')
    && typeExpressionLength(firstRemainder) === 0) {
    const combined = block.lines.join(' ').replace(/\s+/g, ' ');
    if (typeExpressionLength(tagRemainder(combined)) > 0) {
      return { ...block, lines: [stripTypeExpression(combined)] };
    }
  }
  return {
    ...block,
    lines: [stripTypeExpression(block.lines[0]), ...block.lines.slice(1)],
  };
}

function synchronizeDocBlocks(blocks, parameters, returnState, typescript) {
  const parameterBlocks = new Map();
  const parameterChildren = new Map();
  const parameterNames = new Set(parameters.map(({ normalized }) => normalized));
  const returnBlocks = [];
  let firstManagedIndex = -1;

  blocks.forEach((block, index) => {
    const managedReturn = returnState != null && RETURN_TAGS.has(block.tag);
    if (PARAM_TAGS.has(block.tag) || managedReturn) {
      if (firstManagedIndex === -1) firstManagedIndex = index;
    }
    if (PARAM_TAGS.has(block.tag)) {
      const name = documentedParameterName(block);
      if (name && parameterNames.has(name) && !parameterBlocks.has(name)) {
        parameterBlocks.set(name, block);
      } else if (name) {
        const rootName = parameterRootName(name);
        if (parameterNames.has(rootName)) {
          const children = parameterChildren.get(rootName) ?? [];
          children.push(block);
          parameterChildren.set(rootName, children);
        }
      }
    }
    if (managedReturn) returnBlocks.push(block);
  });

  const synchronizedParameters = parameters.flatMap((parameter) => {
    const existing = parameterBlocks.get(parameter.normalized);
    const parent = existing
      ? (typescript ? normalizeTypescriptBlock(existing) : existing)
      : { tag: 'param', lines: [`@param ${parameter.display}`] };
    const children = parameterChildren.get(parameter.normalized) ?? [];
    return [
      parent,
      ...children.map((child) => (
        typescript ? normalizeTypescriptBlock(child) : child
      )),
    ];
  });
  const synchronizedReturns = returnState
    ? [typescript && returnBlocks[0]
      ? normalizeTypescriptBlock(returnBlocks[0])
      : (returnBlocks[0] ?? { tag: 'returns', lines: ['@returns'] })]
    : [];

  const retained = blocks.filter((block) => (
    !PARAM_TAGS.has(block.tag) && !(returnState != null && RETURN_TAGS.has(block.tag))
  ));
  let insertionIndex;
  if (firstManagedIndex >= 0) {
    insertionIndex = blocks
      .slice(0, firstManagedIndex)
      .filter((block) => (
        !PARAM_TAGS.has(block.tag) && !(returnState != null && RETURN_TAGS.has(block.tag))
      )).length;
  } else {
    const descriptionIndex = retained.findLastIndex((block) => block.tag === 'description');
    const trailingManagedIndex = retained.findIndex((block) => (
      RETURN_TAGS.has(block.tag) || THROWS_TAGS.has(block.tag)
    ));
    if (descriptionIndex >= 0) insertionIndex = descriptionIndex + 1;
    else if (trailingManagedIndex >= 0) insertionIndex = trailingManagedIndex;
    else insertionIndex = retained.length;
  }
  return [
    ...retained.slice(0, insertionIndex),
    ...synchronizedParameters,
    ...synchronizedReturns,
    ...retained.slice(insertionIndex),
  ];
}

function renderDocBlocks(blocks, indentation, eol) {
  const lines = trimBlankEdges(blocks.flatMap((block) => block.lines));
  if (lines.length === 0) return null;
  return [
    '/**',
    ...lines.map((line) => `${indentation} *${line ? ` ${line}` : ''}`),
    `${indentation} */`,
  ].join(eol);
}

function lineIndentation(source, offset) {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return source.slice(lineStart, offset).match(/^\s*/)?.[0] ?? '';
}

function leadingJsdoc(comments, source, targetNode) {
  let candidate = null;
  for (const comment of comments) {
    if (comment.type !== 'CommentBlock'
      || comment.end > targetNode.start
      || !source.slice(comment.start, comment.start + 3).startsWith('/**')) {
      continue;
    }
    if (!candidate || comment.end > candidate.end) candidate = comment;
  }
  if (!candidate || !/^\s*$/.test(source.slice(candidate.end, targetNode.start))) return null;
  return candidate;
}

function warning(code, message, relativePath, target, lineOffset) {
  const location = target.functionPath.node.loc?.start;
  return Object.freeze({
    code,
    message,
    functionName: target.name,
    location: Object.freeze({
      path: relativePath,
      line: location ? location.line + lineOffset : null,
      column: location ? location.column + 1 : null,
    }),
  });
}

function synchronizeProgram(source, {
  language,
  lineOffset,
  relativePath,
}) {
  const ast = parseProgram(source, relativePath, language, lineOffset);
  const comments = ast.comments ?? [];
  const edits = [];
  const warnings = [];
  const seenTargets = new Set();
  const typescript = /^(?:ts|tsx)$/.test(language)
    || /\.(?:cts|mts|ts|tsx)$/i.test(relativePath);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';

  traverse(ast, {
    Function(functionPath) {
      const target = functionTarget(functionPath);
      if (!target || seenTargets.has(target.targetPath.node.start)) return;
      seenTargets.add(target.targetPath.node.start);

      const parameterState = parametersForFunction(functionPath.node);
      if (parameterState.unsupported) {
        warnings.push(warning(
          'function-docs/destructured-parameter',
          `函数 ${target.name} 包含匿名解构参数，未自动同步其函数文档`,
          relativePath,
          target,
          lineOffset,
        ));
        return;
      }

      const returnState = hasReturnValue(functionPath);
      if (returnState == null) {
        warnings.push(warning(
          'function-docs/generator-return-unsupported',
          `函数 ${target.name} 是 Generator，未自动同步 @returns；请人工维护 @yields`,
          relativePath,
          target,
          lineOffset,
        ));
      }

      const jsdoc = leadingJsdoc(comments, source, target.targetPath.node);
      const originalBlocks = jsdoc
        ? parseDocBlocks(source.slice(jsdoc.start, jsdoc.end))
        : [];
      const hasThrows = originalBlocks.some((block) => THROWS_TAGS.has(block.tag));
      if (hasEscapingException(functionPath) && !hasThrows) {
        warnings.push(warning(
          'function-docs/missing-throws',
          `函数 ${target.name} 存在直接逃逸的异常路径，请补充 @throws`,
          relativePath,
          target,
          lineOffset,
        ));
      }

      const synchronized = synchronizeDocBlocks(
        originalBlocks,
        parameterState.parameters,
        returnState,
        typescript,
      );
      const indentation = lineIndentation(source, target.targetPath.node.start);
      const rendered = renderDocBlocks(synchronized, indentation, eol);
      if (jsdoc) {
        const original = source.slice(jsdoc.start, jsdoc.end);
        if (rendered !== original) {
          edits.push({ start: jsdoc.start, end: jsdoc.end, replacement: rendered ?? '' });
        }
      } else if (rendered) {
        edits.push({
          start: target.targetPath.node.start,
          end: target.targetPath.node.start,
          replacement: `${rendered}${eol}${indentation}`,
        });
      }
    },
  });

  let content = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    content = `${content.slice(0, edit.start)}${edit.replacement}${content.slice(edit.end)}`;
  }
  return Object.freeze({ content, warnings: Object.freeze(warnings) });
}

function scriptLanguage(attributes) {
  return (attributes.find(({ name }) => name === 'lang')?.value ?? 'js').toLowerCase();
}

function synchronizeVue(content, relativePath) {
  const sections = [];
  for (const block of findVueScriptBlocks(content)) {
    if (block.attributes.some(({ name }) => name === 'src')) continue;
    const start = block.contentStart;
    const end = block.contentEnd;
    const lineOffset = content.slice(0, start).split('\n').length - 1;
    const result = synchronizeProgram(content.slice(start, end), {
      language: scriptLanguage(block.attributes),
      lineOffset,
      relativePath,
    });
    sections.push({ start, end, result });
  }

  let updated = content;
  const warnings = [];
  for (const section of sections.sort((left, right) => right.start - left.start)) {
    updated = `${updated.slice(0, section.start)}${section.result.content}${updated.slice(section.end)}`;
    warnings.unshift(...section.result.warnings);
  }
  return Object.freeze({ content: updated, warnings: Object.freeze(warnings) });
}

export function synchronizeFunctionDocumentationContent(content, relativePath) {
  if (path.extname(relativePath).toLowerCase() === '.vue') {
    return synchronizeVue(content, relativePath);
  }
  return synchronizeProgram(content, {
    language: path.extname(relativePath).slice(1).toLowerCase(),
    lineOffset: 0,
    relativePath,
  });
}
