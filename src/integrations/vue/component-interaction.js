import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { executionError } from '../../core/error/repo-guard-error.js';
import { findVueTemplateAttributes } from './template-parser.js';

const traverse = traverseModule.default ?? traverseModule;
const INTERACTION_METHODS = new Set([
  'setChecked',
  'setSelected',
  'setValue',
  'trigger',
]);
const WRAPPER_QUERY_METHODS = new Set([
  'find',
  'findAll',
  'findComponent',
  'findAllComponents',
  'get',
  'getComponent',
]);
const WRAPPER_OUTCOMES = new Set([
  'attributes',
  'classes',
  'emitted',
  'html',
  'isVisible',
  'props',
  'text',
  'vm',
]);
const MOCK_MATCHERS = new Set([
  'toBeCalled',
  'toBeCalledTimes',
  'toBeCalledWith',
  'toHaveBeenCalled',
  'toHaveBeenCalledOnce',
  'toHaveBeenCalledTimes',
  'toHaveBeenCalledWith',
]);

function parserPlugins(testPath) {
  return [
    ...(/\.(?:cts|mts|ts|tsx)$/i.test(testPath) ? ['typescript'] : []),
    ...(/\.(?:jsx|tsx)$/i.test(testPath) ? ['jsx'] : []),
    'decorators-legacy',
    'importAttributes',
  ];
}

function parseTest(source, testPath) {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: true,
      plugins: parserPlugins(testPath),
      sourceType: 'unambiguous',
    });
  } catch (error) {
    const location = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : '';
    throw executionError(
      'component-interaction/test-parse-failed',
      `组件交互门禁无法解析 ${testPath}${location}：`
      + `${error.reasonCode ?? error.message}`,
      { cause: error, details: { location: { path: testPath } } },
    );
  }
}

function propertyName(member) {
  if (!member?.computed && member?.property?.type === 'Identifier') {
    return member.property.name;
  }
  if (member?.computed && member?.property?.type === 'StringLiteral') {
    return member.property.value;
  }
  return null;
}

function importedComponentNames(ast, sourcePath, testPath) {
  const names = new Set();
  const sourceBase = path.posix.basename(sourcePath);
  const sourceStem = path.posix.basename(sourcePath, '.vue');
  const testDirectory = path.posix.dirname(testPath);
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const specifier = statement.source.value.replace(/\\/g, '/');
    const resolved = specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(testDirectory, specifier))
      : null;
    if (resolved !== sourcePath
      && `${resolved}.vue` !== sourcePath
      && path.posix.basename(specifier) !== sourceBase
      && path.posix.basename(specifier) !== sourceStem) continue;
    for (const item of statement.specifiers) names.add(item.local.name);
  }
  return names;
}

function mountFunctionNames(ast) {
  const names = new Set();
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration'
      || statement.source.value !== '@vue/test-utils') {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'mount') {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
}

function testCallback(callPath) {
  const callee = callPath.node.callee;
  let base = callee;
  while (base) {
    if (base.type === 'MemberExpression' || base.type === 'OptionalMemberExpression') {
      base = base.object;
    } else if (base.type === 'CallExpression' || base.type === 'OptionalCallExpression') {
      base = base.callee;
    } else {
      break;
    }
  }
  if (base?.type !== 'Identifier' || (base.name !== 'it' && base.name !== 'test')) return null;
  return callPath.get('arguments').find((argument) => (
    argument.isFunctionExpression() || argument.isArrowFunctionExpression()
  )) ?? null;
}

function referencesWrapper(node, wrapperNames) {
  if (!node) return false;
  if (node.type === 'Identifier') return wrapperNames.has(node.name);
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    return referencesWrapper(node.object, wrapperNames);
  }
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    return referencesWrapper(node.callee, wrapperNames);
  }
  if (node.type === 'AwaitExpression' || node.type === 'ChainExpression') {
    return referencesWrapper(node.argument ?? node.expression, wrapperNames);
  }
  return false;
}

function outcomeArgument(argument, wrapperNames) {
  if (!argument) return false;
  const stack = [argument];
  let hasWrapper = false;
  let hasOutcome = false;
  let hasStateObject = false;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'Identifier') {
      if (wrapperNames.has(node.name)) hasWrapper = true;
      if (/^(?:router|route|store|pinia)$/i.test(node.name)) hasStateObject = true;
    }
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      if (WRAPPER_OUTCOMES.has(propertyName(node))) hasOutcome = true;
      if (propertyName(node) === 'exists'
        && node.object?.type === 'CallExpression'
        && (node.object.callee?.type === 'MemberExpression'
          || node.object.callee?.type === 'OptionalMemberExpression')
        && new Set(['find', 'findComponent', 'get', 'getComponent'])
          .has(propertyName(node.object.callee))) {
        hasOutcome = true;
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'extra' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === 'object') stack.push(value);
    }
  }
  return (hasWrapper && hasOutcome) || hasStateObject;
}

function inspectCallback(callbackPath, mountNames, componentNames) {
  const wrapperNames = new Set();
  const mountOffsets = [];
  callbackPath.traverse({
    VariableDeclarator(variablePath) {
      const { id, init } = variablePath.node;
      if (id.type !== 'Identifier'
        || init?.type !== 'CallExpression'
        || init.callee.type !== 'Identifier'
        || !mountNames.has(init.callee.name)
        || init.arguments[0]?.type !== 'Identifier'
        || !componentNames.has(init.arguments[0].name)) {
        return;
      }
      wrapperNames.add(id.name);
      mountOffsets.push(init.start);
    },
  });
  if (wrapperNames.size === 0) return { assertion: false, interaction: false, mount: false };

  callbackPath.traverse({
    VariableDeclarator(variablePath) {
      const { id, init } = variablePath.node;
      if (id.type !== 'Identifier'
        || init?.type !== 'CallExpression'
        || (init.callee.type !== 'MemberExpression'
          && init.callee.type !== 'OptionalMemberExpression')
        || !WRAPPER_QUERY_METHODS.has(propertyName(init.callee))
        || !referencesWrapper(init.callee.object, wrapperNames)) {
        return;
      }
      wrapperNames.add(id.name);
    },
  });

  const interactionOffsets = [];
  const assertionOffsets = [];
  callbackPath.traverse({
    CallExpression(innerPath) {
      const { node } = innerPath;
      if ((node.callee.type === 'MemberExpression'
          || node.callee.type === 'OptionalMemberExpression')
        && INTERACTION_METHODS.has(propertyName(node.callee))
        && referencesWrapper(node.callee.object, wrapperNames)) {
        interactionOffsets.push(node.start);
      }
      if ((node.callee.type === 'MemberExpression'
          || node.callee.type === 'OptionalMemberExpression')
        && MOCK_MATCHERS.has(propertyName(node.callee))
        && node.callee.object?.type === 'CallExpression'
        && node.callee.object.callee?.type === 'Identifier'
        && node.callee.object.callee.name === 'expect') {
        assertionOffsets.push(node.start);
      }
      if (node.callee.type === 'Identifier'
        && node.callee.name === 'expect'
        && outcomeArgument(node.arguments[0], wrapperNames)) {
        assertionOffsets.push(node.start);
      }
    },
  });
  const mountOffset = Math.min(...mountOffsets);
  const interactionOffset = interactionOffsets.find((offset) => offset > mountOffset);
  const assertionOffset = interactionOffset == null
    ? null
    : assertionOffsets.find((offset) => offset > interactionOffset);
  return {
    assertion: assertionOffset != null,
    interaction: interactionOffset != null,
    mount: true,
  };
}

export function findVueInteractionEntries(source, relativePath = 'Component.vue') {
  return findVueTemplateAttributes(source)
    .filter(({ name }) => (
      name === 'v-model'
      || name.startsWith('v-model:')
      || name.startsWith('v-model.')
      || name === 'v-on'
      || name.startsWith('v-on:')
      || name.startsWith('@')
    ))
    .map(({ name, offset }) => ({ name, offset, path: relativePath }));
}

export function analyzeVueComponentInteractionTest({
  componentSourcePath,
  testPath,
  testSource,
}) {
  const ast = parseTest(testSource, testPath);
  const componentNames = importedComponentNames(ast, componentSourcePath, testPath);
  const mountNames = mountFunctionNames(ast);
  const progress = {
    assertion: false,
    componentImport: componentNames.size > 0,
    interaction: false,
    mount: false,
    valid: false,
  };
  if (!progress.componentImport || mountNames.size === 0) return progress;

  traverse(ast, {
    CallExpression(callPath) {
      const callback = testCallback(callPath);
      if (!callback) return;
      const result = inspectCallback(callback, mountNames, componentNames);
      progress.mount ||= result.mount;
      progress.interaction ||= result.interaction;
      progress.assertion ||= result.assertion;
      if (result.mount && result.interaction && result.assertion) progress.valid = true;
      callPath.skip();
    },
  });
  return progress;
}
