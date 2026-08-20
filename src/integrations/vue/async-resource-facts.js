import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { executionError } from '../../core/error/repo-guard-error.js';
import { findVueScriptBlocks } from './template-parser.js';

const traverse = traverseModule.default ?? traverseModule;
const GLOBAL_OBJECTS = new Set(['global', 'globalThis', 'self', 'window']);
const UNMOUNT_HOOKS = new Set([
  'onBeforeUnmount', 'onUnmounted', 'onScopeDispose',
  'beforeUnmount', 'unmounted', 'beforeDestroy', 'destroyed',
]);
const DEACTIVATE_HOOKS = new Set(['onDeactivated']);
const ACTIVATE_HOOKS = new Set(['onActivated']);
const OBSERVERS = new Set([
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
]);
const CLOSEABLES = new Set(['WebSocket', 'EventSource', 'BroadcastChannel']);

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

function staticProperty(node) {
  if (!node?.computed && node?.property?.type === 'Identifier') return node.property.name;
  if (node?.computed && node?.property?.type === 'StringLiteral') return node.property.value;
  return null;
}

function bindingKey(scope, name) {
  const binding = scope.getBinding(name);
  return binding ? `binding:${name}:${binding.identifier.start}` : `global:${name}`;
}

function referenceKey(node, scope) {
  if (!node) return null;
  if (node.type === 'TSAsExpression'
    || node.type === 'TSNonNullExpression'
    || node.type === 'TSSatisfiesExpression'
    || node.type === 'TypeCastExpression') {
    return referenceKey(node.expression, scope);
  }
  if (node.type === 'Identifier') return bindingKey(scope, node.name);
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const property = staticProperty(node);
    const object = referenceKey(node.object, scope);
    return object && property ? `${object}.${property}` : null;
  }
  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    return `function:${node.start}`;
  }
  return null;
}

function calleeName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression') {
    const object = calleeName(node.object);
    const property = staticProperty(node);
    return object && property ? `${object}.${property}` : null;
  }
  return null;
}

function globalCapability(callPath, name) {
  const { callee } = callPath.node;
  if (callee?.type === 'Identifier') {
    return callee.name === name && !callPath.scope.hasBinding(name, true);
  }
  if (callee?.type !== 'MemberExpression' && callee?.type !== 'OptionalMemberExpression') {
    return false;
  }
  return callee.object?.type === 'Identifier'
    && GLOBAL_OBJECTS.has(callee.object.name)
    && !callPath.scope.hasBinding(callee.object.name, true)
    && staticProperty(callee) === name;
}

function globalConstructor(newPath, names) {
  const { callee } = newPath.node;
  if (callee?.type === 'Identifier') {
    return names.has(callee.name) && !newPath.scope.hasBinding(callee.name, true)
      ? callee.name
      : null;
  }
  if (callee?.type !== 'MemberExpression') return null;
  const property = staticProperty(callee);
  return callee.object?.type === 'Identifier'
    && GLOBAL_OBJECTS.has(callee.object.name)
    && !newPath.scope.hasBinding(callee.object.name, true)
    && names.has(property)
    ? property
    : null;
}

function assignedReference(expressionPath) {
  let current = expressionPath;
  while (current.parentPath?.isTSAsExpression?.()
    || current.parentPath?.isTSNonNullExpression?.()
    || current.parentPath?.isAwaitExpression?.()) {
    current = current.parentPath;
  }
  const parent = current.parentPath;
  if (parent?.isVariableDeclarator() && parent.node.init === current.node) {
    return referenceKey(parent.node.id, parent.scope);
  }
  if (parent?.isAssignmentExpression() && parent.node.right === current.node) {
    return referenceKey(parent.node.left, parent.scope);
  }
  return null;
}

function objectOption(node, name) {
  if (node?.type !== 'ObjectExpression') return null;
  const property = node.properties.find((item) => (
    (item.type === 'ObjectProperty' || item.type === 'ObjectMethod')
    && ((item.computed && item.key.type === 'StringLiteral' && item.key.value === name)
      || (!item.computed && item.key.type === 'Identifier' && item.key.name === name))
  ));
  return property?.value ?? null;
}

function staticString(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? '';
  }
  return null;
}

function literalBoolean(node) {
  return node?.type === 'BooleanLiteral' ? node.value : null;
}

function eventOptions(node, scope) {
  if (!node) return { capture: false, once: false, signal: null };
  if (node.type === 'NullLiteral'
    || (node.type === 'Identifier' && node.name === 'undefined'
      && !scope.hasBinding('undefined', true))) {
    return { capture: false, once: false, signal: null };
  }
  if (node.type === 'BooleanLiteral') {
    return { capture: node.value, once: false, signal: null };
  }
  const captureNode = objectOption(node, 'capture');
  const capture = captureNode == null ? false : literalBoolean(captureNode) ?? 'dynamic';
  const once = literalBoolean(objectOption(node, 'once'));
  const signal = objectOption(node, 'signal');
  const signalKey = referenceKey(signal, scope);
  return {
    capture,
    once: once === true,
    signal: signalKey?.endsWith('.signal') ? signalKey.slice(0, -7) : null,
  };
}

function isPromiseSleep(callPath) {
  if (!globalCapability(callPath, 'setTimeout')) return false;
  const functionParent = callPath.getFunctionParent();
  const newExpression = functionParent?.parentPath;
  if (!functionParent || !newExpression?.isNewExpression()) return false;
  if (newExpression.node.callee.type !== 'Identifier'
    || newExpression.node.callee.name !== 'Promise'
    || newExpression.scope.hasBinding('Promise', true)) {
    return false;
  }
  const resolve = functionParent.node.params[0];
  return resolve?.type === 'Identifier'
    && callPath.node.arguments[0]?.type === 'Identifier'
    && callPath.node.arguments[0].name === resolve.name;
}

function isRecurringAnimationFrame(callPath) {
  const callback = callPath.get('arguments.0');
  if (!callback?.isIdentifier()) return false;
  const callbackKey = referenceKey(callback.node, callback.scope);
  const functionPath = functionPathFromBinding(callback.scope.getBinding(callback.node.name));
  if (!functionPath) return false;
  let recurring = false;
  functionPath.traverse({
    CallExpression(nestedCall) {
      if (globalCapability(nestedCall, 'requestAnimationFrame')
        && referenceKey(nestedCall.node.arguments[0], nestedCall.scope) === callbackKey) {
        recurring = true;
      }
    },
    Function(nestedFunction) {
      if (nestedFunction.node !== functionPath.node) nestedFunction.skip();
    },
  });
  return recurring;
}

function functionPathFromBinding(binding) {
  if (!binding) return null;
  if (binding.path.isFunctionDeclaration()) return binding.path;
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.get('init');
    return init?.isFunction?.() ? init : null;
  }
  return null;
}

function callbackFunctionPath(callPath) {
  const argument = callPath.get('arguments.0');
  if (argument?.isFunction?.()) return argument;
  if (argument?.isIdentifier?.()) {
    return functionPathFromBinding(argument.scope.getBinding(argument.node.name));
  }
  return null;
}

function expressionFunctionPath(expressionPath) {
  if (expressionPath?.isFunction?.()) return expressionPath;
  if (expressionPath?.isIdentifier?.()) {
    return functionPathFromBinding(
      expressionPath.scope.getBinding(expressionPath.node.name),
    );
  }
  return null;
}

function optionsMethodPath(callPath) {
  if ((callPath.node.callee.type !== 'MemberExpression'
      && callPath.node.callee.type !== 'OptionalMemberExpression')
    || callPath.node.callee.object.type !== 'ThisExpression') return null;
  const methodName = staticProperty(callPath.node.callee);
  const object = callPath.findParent((parent) => parent.isObjectExpression());
  let method = object?.get('properties').find((property) => (
    (property.isObjectMethod() || property.isObjectProperty())
    && !property.node.computed
    && property.node.key.name === methodName
  ));
  if (!method) {
    const methodsProperty = object?.get('properties').find((property) => (
      property.isObjectProperty()
      && !property.node.computed
      && property.node.key.name === 'methods'
      && property.get('value').isObjectExpression()
    ));
    method = methodsProperty?.get('value.properties').find((property) => (
      (property.isObjectMethod() || property.isObjectProperty())
      && !property.node.computed
      && property.node.key.name === methodName
    ));
  }
  if (method?.isObjectMethod()) return method;
  return method?.isObjectProperty() ? expressionFunctionPath(method.get('value')) : null;
}

function isVueOptionsObject(objectPath) {
  const parent = objectPath.parentPath;
  if (parent?.isExportDefaultDeclaration()) return true;
  if (parent?.isCallExpression() && parent.node.arguments.includes(objectPath.node)) {
    const name = calleeName(parent.node.callee);
    return name === 'defineComponent' || name === 'Vue.extend';
  }
  if (!parent?.isVariableDeclarator() || parent.node.id.type !== 'Identifier') return false;
  const binding = parent.scope.getBinding(parent.node.id.name);
  return binding?.referencePaths.some((reference) => (
    reference.parentPath?.isExportDefaultDeclaration()
  )) ?? false;
}

function hasPriorAwait(path) {
  const functionParent = path.getFunctionParent();
  const searchRoot = functionParent ?? path.findParent((parent) => parent.isProgram());
  if (!searchRoot) return false;
  let found = false;
  searchRoot.traverse({
    AwaitExpression(awaitPath) {
      if (awaitPath.node.start < path.node.start) found = true;
    },
    Function(nestedPath) {
      if (!functionParent || nestedPath.node !== functionParent.node) nestedPath.skip();
    },
  });
  return found;
}

function isConditionallyExecuted(path) {
  let current = path.parentPath;
  while (current && !current.isFunction() && !current.isProgram()) {
    if (current.isIfStatement()
      || current.isConditionalExpression()
      || current.isLogicalExpression()
      || current.isSwitchCase()
      || current.isForStatement()
      || current.isForInStatement()
      || current.isForOfStatement()
      || current.isWhileStatement()
      || current.isDoWhileStatement()) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

function vueSetupFunctions(programPath) {
  const functions = new Set();
  const queue = [];
  const enqueue = (functionPath) => {
    if (!functionPath || functions.has(functionPath.node)) return;
    functions.add(functionPath.node);
    queue.push(functionPath);
  };
  programPath.traverse({
    CallExpression(callPath) {
      if (callPath.getFunctionParent()
        || isConditionallyExecuted(callPath)
        || hasPriorAwait(callPath)
        || callPath.node.callee.type !== 'Identifier') return;
      enqueue(functionPathFromBinding(
        callPath.scope.getBinding(callPath.node.callee.name),
      ));
    },
    ObjectMethod(methodPath) {
      if (!methodPath.node.computed
        && methodPath.node.key.name === 'setup'
        && isVueOptionsObject(methodPath.parentPath)) enqueue(methodPath);
    },
    ObjectProperty(propertyPath) {
      if (!propertyPath.node.computed
        && propertyPath.node.key.name === 'setup'
        && isVueOptionsObject(propertyPath.parentPath)) {
        enqueue(expressionFunctionPath(propertyPath.get('value')));
      }
    },
  });
  while (queue.length > 0) {
    const functionPath = queue.shift();
    functionPath.traverse({
      Function(nestedPath) {
        nestedPath.skip();
      },
      'CallExpression|OptionalCallExpression'(callPath) {
        if (isConditionallyExecuted(callPath)
          || hasPriorAwait(callPath)
          || callPath.node.callee.type !== 'Identifier') return;
        enqueue(functionPathFromBinding(
          callPath.scope.getBinding(callPath.node.callee.name),
        ));
      },
    });
  }
  return functions;
}

function importAliases(programPath) {
  const aliases = new Map();
  for (const statement of programPath.get('body')) {
    if (!statement.isImportDeclaration() || statement.node.source.value !== 'vue') continue;
    for (const specifier of statement.get('specifiers')) {
      if (!specifier.isImportSpecifier()) continue;
      const imported = specifier.node.imported;
      const importedName = imported.type === 'Identifier' ? imported.name : imported.value;
      aliases.set(specifier.node.local.name, {
        identifier: specifier.node.local,
        importedName,
      });
    }
  }
  return aliases;
}

function vueHookName(callPath, aliases) {
  const { callee } = callPath.node;
  if (callee.type !== 'Identifier') return null;
  const imported = aliases.get(callee.name);
  if (imported
    && callPath.scope.getBinding(callee.name)?.identifier === imported.identifier) {
    return imported.importedName;
  }
  const known = UNMOUNT_HOOKS.has(callee.name)
    || DEACTIVATE_HOOKS.has(callee.name)
    || ACTIVATE_HOOKS.has(callee.name);
  return known && !callPath.scope.hasBinding(callee.name, true) ? callee.name : null;
}

function collectLifecycleFunctions(programPath, aliases, relativePath) {
  const cleanupFunctions = new Map();
  const activatedFunctions = new Set();
  const setupFunctions = relativePath.toLowerCase().endsWith('.vue')
    ? vueSetupFunctions(programPath)
    : null;
  const queue = [];
  const activatedQueue = [];
  const enqueue = (functionPath, lifetime) => {
    if (!functionPath) return;
    const lifetimes = cleanupFunctions.get(functionPath.node) ?? new Set();
    if (lifetimes.has(lifetime)) return;
    lifetimes.add(lifetime);
    cleanupFunctions.set(functionPath.node, lifetimes);
    queue.push({ functionPath, lifetime });
  };
  const enqueueActivated = (functionPath) => {
    if (!functionPath || activatedFunctions.has(functionPath.node)) return;
    activatedFunctions.add(functionPath.node);
    activatedQueue.push(functionPath);
  };

  programPath.traverse({
    CallExpression(callPath) {
      const hook = vueHookName(callPath, aliases);
      const callback = callbackFunctionPath(callPath);
      const functionParent = callPath.getFunctionParent();
      const reachable = !isConditionallyExecuted(callPath)
        && !hasPriorAwait(callPath)
        && (setupFunctions == null || functionParent == null
          || setupFunctions.has(functionParent.node));
      if (!reachable) return;
      if (UNMOUNT_HOOKS.has(hook)) enqueue(callback, 'unmount');
      else if (DEACTIVATE_HOOKS.has(hook)) enqueue(callback, 'deactivate');
      else if (ACTIVATE_HOOKS.has(hook)) enqueueActivated(callback);
    },
    ObjectMethod(methodPath) {
      if (!isVueOptionsObject(methodPath.parentPath)) return;
      const name = methodPath.node.computed ? null : methodPath.node.key.name;
      if (UNMOUNT_HOOKS.has(name)) enqueue(methodPath, 'unmount');
      if (name === 'deactivated') enqueue(methodPath, 'deactivate');
      if (name === 'activated') enqueueActivated(methodPath);
    },
    ObjectProperty(propertyPath) {
      if (!isVueOptionsObject(propertyPath.parentPath)) return;
      const name = propertyPath.node.computed ? null : propertyPath.node.key.name;
      const value = propertyPath.get('value');
      const callback = expressionFunctionPath(value);
      if (UNMOUNT_HOOKS.has(name)) enqueue(callback, 'unmount');
      if (name === 'deactivated') enqueue(callback, 'deactivate');
      if (name === 'activated') enqueueActivated(callback);
    },
  });

  while (queue.length > 0) {
    const { functionPath, lifetime } = queue.shift();
    functionPath.traverse({
      Function(nestedPath) {
        nestedPath.skip();
      },
      'CallExpression|OptionalCallExpression'(callPath) {
        if (callPath.node.callee.type === 'Identifier') {
          enqueue(
            functionPathFromBinding(callPath.scope.getBinding(callPath.node.callee.name)),
            lifetime,
          );
          return;
        }
        enqueue(optionsMethodPath(callPath), lifetime);
      },
    });
  }
  while (activatedQueue.length > 0) {
    const functionPath = activatedQueue.shift();
    functionPath.traverse({
      Function(nestedPath) {
        nestedPath.skip();
      },
      'CallExpression|OptionalCallExpression'(callPath) {
        if (callPath.node.callee.type === 'Identifier') {
          enqueueActivated(
            functionPathFromBinding(callPath.scope.getBinding(callPath.node.callee.name)),
          );
        } else {
          enqueueActivated(optionsMethodPath(callPath));
        }
      },
    });
  }
  return { activatedFunctions, cleanupFunctions };
}

function containingCleanupLifetimes(path, functions) {
  let current = path;
  while (current) {
    if (current.isFunction?.()) return [...(functions.get(current.node) ?? [])];
    current = current.parentPath;
  }
  return [];
}

function containedInFunction(path, functions) {
  let current = path;
  while (current) {
    if (current.isFunction?.() && functions.has(current.node)) return true;
    current = current.parentPath;
  }
  return false;
}

function addFact(collection, path, value, offsetBase) {
  collection.push({ ...value, offset: offsetBase + path.node.start });
}

function collectScriptFacts(source, relativePath, language, offsetBase, options) {
  let ast;
  try {
    ast = parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      plugins: parserPlugins(relativePath, language),
      sourceType: 'unambiguous',
    });
  } catch (error) {
    const line = error.loc?.line;
    const column = error.loc ? error.loc.column + 1 : null;
    throw executionError(
      'async-resource-cleanup/source-parse-failed',
      `异步资源清理门禁无法解析 ${relativePath}${line ? `:${line}:${column}` : ''}：${error.reasonCode ?? error.message}`,
      { cause: error, details: { location: { path: relativePath } } },
    );
  }

  const acquisitions = [];
  const releases = [];
  traverse(ast, {
    Program(programPath) {
      const aliases = importAliases(programPath);
      const { activatedFunctions, cleanupFunctions } = collectLifecycleFunctions(
        programPath,
        aliases,
        relativePath,
      );
      const cleanupLifetimes = (path) => containingCleanupLifetimes(path, cleanupFunctions);
      const acquisitionLifetime = (path) => (
        containedInFunction(path, activatedFunctions) ? 'deactivate' : 'unmount'
      );

      programPath.traverse({
        'CallExpression|OptionalCallExpression'(callPath) {
          const lifetimes = cleanupLifetimes(callPath);
          const args = callPath.node.arguments;
          const callee = callPath.node.callee;
          const member = callee.type === 'MemberExpression'
            || callee.type === 'OptionalMemberExpression';
          const method = member ? staticProperty(callee) : null;

          if (lifetimes.length > 0) {
            if (hasPriorAwait(callPath)) return;
            const release = (kind, handle, extra = {}) => {
              for (const lifetime of lifetimes) {
                addFact(releases, callPath, { kind, handle, lifetime, ...extra }, offsetBase);
              }
            };
            if (globalCapability(callPath, 'clearInterval')) release('interval', referenceKey(args[0], callPath.scope));
            else if (globalCapability(callPath, 'clearTimeout')) release('timeout', referenceKey(args[0], callPath.scope));
            else if (globalCapability(callPath, 'cancelAnimationFrame')) release('animation-frame', referenceKey(args[0], callPath.scope));
            else if (member && method === 'removeEventListener') release('event-listener', null, {
              target: referenceKey(callee.object, callPath.scope),
              event: staticString(args[0]),
              callback: referenceKey(args[1], callPath.scope),
              capture: eventOptions(args[2], callPath.scope).capture,
            });
            else if (member && method === 'disconnect') release('observer', referenceKey(callee.object, callPath.scope));
            else if (member && method === 'close') release('closeable', referenceKey(callee.object, callPath.scope));
            else if (member && method === 'terminate') release('worker', referenceKey(callee.object, callPath.scope));
            else if (member && (method === 'unsubscribe' || method === 'dispose')) release('subscription', referenceKey(callee.object, callPath.scope));
            else if (member && method === 'abort') release('abort-controller', referenceKey(callee.object, callPath.scope));
            else if (member && method === 'clearWatch') release('geolocation-watch', referenceKey(args[0], callPath.scope), {
              target: referenceKey(callee.object, callPath.scope),
            });
            else if (callee.type === 'Identifier' && args.length === 0) {
              release('subscription', referenceKey(callee, callPath.scope));
            }
            return;
          }

          const acquire = (kind, handle, extra = {}) => addFact(acquisitions, callPath, {
            kind,
            handle,
            lifetime: acquisitionLifetime(callPath),
            ...extra,
          }, offsetBase);
          if (globalCapability(callPath, 'setInterval')) {
            acquire('interval', assignedReference(callPath));
          } else if (globalCapability(callPath, 'setTimeout')) {
            if (isPromiseSleep(callPath)) return;
            const delay = args[1];
            if (delay?.type === 'NumericLiteral' && delay.value < options.timeoutThresholdMs) return;
            acquire('timeout', assignedReference(callPath), {
              dynamicDelay: delay?.type !== 'NumericLiteral',
            });
          } else if (globalCapability(callPath, 'requestAnimationFrame')) {
            const handle = assignedReference(callPath);
            if (handle || isRecurringAnimationFrame(callPath)) {
              acquire('animation-frame', handle);
            }
          } else if (member && method === 'addEventListener') {
            const event = staticString(args[0]);
            const eventConfig = eventOptions(args[2], callPath.scope);
            if (eventConfig.once) return;
            acquire(eventConfig.signal ? 'abort-controller' : 'event-listener', eventConfig.signal, {
              target: referenceKey(callee.object, callPath.scope),
              event,
              callback: referenceKey(args[1], callPath.scope),
              capture: eventConfig.capture,
            });
          } else if (member && method === 'subscribe') {
            acquire('subscription', assignedReference(callPath));
          } else if (member && method === 'watchPosition') {
            acquire('geolocation-watch', assignedReference(callPath), {
              target: referenceKey(callee.object, callPath.scope),
            });
          } else {
            const builtinFetch = globalCapability(callPath, 'fetch');
            const name = builtinFetch ? 'fetch' : calleeName(callee);
            if (!name || !options.requestFunctions.includes(name)) return;
            if (name === 'fetch' && !builtinFetch) return;
            const signal = args
              .map((argument) => objectOption(argument, 'signal'))
              .find((candidate) => candidate != null);
            const signalKey = referenceKey(signal, callPath.scope);
            acquire('abort-controller', signalKey?.endsWith('.signal')
              ? signalKey.slice(0, -7)
              : null, { request: name });
          }
        },
        NewExpression(newPath) {
          if (cleanupLifetimes(newPath).length > 0) return;
          const observer = globalConstructor(newPath, OBSERVERS);
          const closeable = globalConstructor(newPath, CLOSEABLES);
          const worker = globalConstructor(newPath, new Set(['Worker']));
          const kind = observer ? 'observer' : closeable ? 'closeable' : worker ? 'worker' : null;
          if (!kind) return;
          addFact(acquisitions, newPath, {
            kind,
            handle: assignedReference(newPath),
            lifetime: acquisitionLifetime(newPath),
            resourceName: observer ?? closeable ?? worker,
          }, offsetBase);
        },
      });
      programPath.stop();
    },
  });
  const scopedReference = (value) => value == null ? null : `${offsetBase}:${value}`;
  const scopeFacts = (facts) => facts.map((fact) => ({
    ...fact,
    handle: scopedReference(fact.handle),
    ...(Object.hasOwn(fact, 'target') ? { target: scopedReference(fact.target) } : {}),
    ...(Object.hasOwn(fact, 'callback') ? { callback: scopedReference(fact.callback) } : {}),
  }));
  return {
    acquisitions: scopeFacts(acquisitions),
    releases: scopeFacts(releases),
  };
}

function languageOf(block) {
  return block.attributes.find(({ name }) => name === 'lang')?.value?.toLowerCase() ?? '';
}

export function extractAsyncResourceFacts(source, relativePath, options) {
  const blocks = relativePath.toLowerCase().endsWith('.vue')
    ? findVueScriptBlocks(source)
      .filter((block) => !block.attributes.some(({ name }) => name === 'src'))
      .map((block) => ({
        source: source.slice(block.contentStart, block.contentEnd),
        language: languageOf(block),
        offsetBase: block.contentStart,
      }))
    : [{ source, language: '', offsetBase: 0 }];
  const facts = blocks.map((block) => collectScriptFacts(
    block.source,
    relativePath,
    block.language,
    block.offsetBase,
    options,
  ));
  return {
    acquisitions: facts.flatMap(({ acquisitions }) => acquisitions),
    releases: facts.flatMap(({ releases }) => releases),
  };
}
