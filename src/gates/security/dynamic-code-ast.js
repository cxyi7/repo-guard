import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { executionError } from '../../core/error/repo-guard-error.js';

const traverse = traverseModule.default ?? traverseModule;
const GLOBAL_OBJECTS = new Set(['global', 'globalThis', 'self', 'window']);

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

function memberCapability(node) {
  if (!node.computed) {
    return node.property?.type === 'Identifier' ? node.property.name : null;
  }
  if (node.property?.type === 'StringLiteral') return node.property.value;
  if (node.property?.type === 'TemplateLiteral' && node.property.expressions.length === 0) {
    return node.property.quasis[0]?.value.cooked;
  }
  return null;
}

function isTypeOnlyReference(identifierPath) {
  const parent = identifierPath.parentPath;
  if (!parent?.node.type.startsWith('TS')) return false;
  if ((parent.isTSAsExpression?.()
      || parent.isTSSatisfiesExpression?.()
      || parent.isTSNonNullExpression?.()
      || parent.isTSInstantiationExpression?.())
    && parent.node.expression === identifierPath.node) {
    return false;
  }
  return true;
}

export function findDynamicCodeAstReferences(source, relativePath, language = '') {
  let ast;
  try {
    ast = parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      plugins: parserPlugins(relativePath, language),
      sourceType: 'unambiguous',
    });
  } catch (error) {
    const location = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : '';
    throw executionError(
      'dynamic-code/source-parse-failed',
      `Dynamic code gate could not parse ${relativePath}${location}: ${error.reasonCode ?? error.message}`,
      { cause: error, details: { location: { path: relativePath } } },
    );
  }

  const findings = [];
  const seen = new Set();
  const add = (node, kind) => {
    const key = `${kind}\0${node.start}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, offset: node.start });
  };
  const inspectMember = (memberPath) => {
    const { node } = memberPath;
    if (node.object?.type !== 'Identifier'
      || !GLOBAL_OBJECTS.has(node.object.name)
      || memberPath.scope.hasBinding(node.object.name, true)) {
      return;
    }
    const capability = memberCapability(node);
    if (capability !== 'eval' && capability !== 'Function') return;
    add(node.property, capability === 'eval' ? 'eval' : 'Function');
  };

  traverse(ast, {
    Identifier(identifierPath) {
      const { name } = identifierPath.node;
      if ((name !== 'eval' && name !== 'Function')
        || !identifierPath.isReferencedIdentifier()
        || isTypeOnlyReference(identifierPath)
        || identifierPath.scope.hasBinding(name, true)) {
        return;
      }
      add(identifierPath.node, name === 'eval' ? 'eval' : 'Function');
    },
    MemberExpression: inspectMember,
    OptionalMemberExpression: inspectMember,
  });
  return findings.sort((left, right) => left.offset - right.offset);
}
