import { parse, parseExpression } from '@babel/parser';
import { executionError } from '../core/error/repo-guard-error.js';

/** 只读取语法中的字面量，不计算表达式或追踪变量。 */
export function literalString(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? null;
  return null;
}

export function memberName(node) {
  if (!['MemberExpression', 'OptionalMemberExpression'].includes(node?.type))
    return null;
  return node.computed ? literalString(node.property) : node.property.name;
}

export function globalIdentifier(node, scope, names) {
  return (
    node?.type === 'Identifier' &&
    names.includes(node.name) &&
    !scope.hasBinding(node.name, true)
  );
}

export function globalMember(
  node,
  scope,
  names,
  objects = ['window', 'globalThis', 'self'],
) {
  return (
    globalIdentifier(node?.object, scope, objects) &&
    names.includes(memberName(node))
  );
}

export function globalApi(node, scope, names, objects) {
  return (
    globalIdentifier(node, scope, names) ||
    globalMember(node, scope, names, objects)
  );
}

export function parseSecurityScript(source, filename, language = '') {
  try {
    return parse(source, {
      sourceType: 'unambiguous',
      plugins: [
        ...(/^(ts|tsx)$/.test(language) || /\.(ts|tsx|mts|cts)$/i.test(filename)
          ? ['typescript']
          : []),
        ...(/^(jsx|tsx)$/.test(language) || /\.(jsx|tsx)$/i.test(filename)
          ? ['jsx']
          : []),
        'decorators-legacy',
        'importAttributes',
      ],
    });
  } catch (cause) {
    throw executionError(
      'source-security/parse-failed',
      `源码安全检查无法解析 ${filename}，未完成检查。`,
      { cause },
    );
  }
}

export function expressionString(source) {
  try {
    return literalString(parseExpression(source));
  } catch {
    return null;
  }
}

export function forbiddenScheme(value, script = false) {
  if (value === null) return false;
  const text = value.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < text.length && text.charCodeAt(start) <= 32) start += 1;
  const normalized = text.slice(start).toLowerCase();
  return (
    script ? ['javascript:', 'data:'] : ['javascript:', 'vbscript:', 'data:']
  ).some((scheme) => normalized.startsWith(scheme));
}

export function windowProtection(value, options, features = false) {
  const text = features ? value.replace(/[\t\n\f\r ]*=[\t\n\f\r ]*/g, '=') : value;
  const tokens = text
    .toLowerCase()
    .split(features ? /[\t\n\f\r ,]+/ : /[\t\n\f\r ]+/)
    .filter(Boolean);
  const featureValues = new Map(
    tokens.map((token) => {
      const [key, candidate = 'yes'] = token.split('=');
      return [key, candidate];
    }),
  );
  const enabled = (name) =>
    features
      ? ['1', 'yes', 'true'].includes(featureValues.get(name))
      : tokens.includes(name);
  return (
    (options.requireNoopener && !enabled('noopener')) ||
    (options.requireNoreferrer && !enabled('noreferrer')) ||
    (options.forbidOpener && enabled('opener'))
  );
}
