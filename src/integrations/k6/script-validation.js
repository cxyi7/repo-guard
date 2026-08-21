import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { configurationError, securityError } from '../../core/error/repo-guard-error.js';

const traverse = traverseModule.default ?? traverseModule;
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'del']);
const SAFE_METHODS = new Set(['get', 'head', 'options']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.ts']);
const FORBIDDEN_EXPORTS = new Set(['options', 'handleSummary']);
const HTTP_OBJECT_MEMBERS = new Set([
  ...SAFE_METHODS,
  ...WRITE_METHODS,
  'batch',
  'cookieJar',
  'expectedStatuses',
  'request',
]);

function scriptError(code, message, relativePath, { security = false, cause } = {}) {
  const createError = security ? securityError : configurationError;
  return createError(`k6-load/${code}`, message, {
    cause,
    details: { location: { path: relativePath } },
    expected: 'k6 脚本只能使用仓库内本地模块、受控目标变量和可静态验证的请求方法。',
    remediation: {
      goal: '修正 k6 脚本，使负载和网络目标继续由 repo-guard 控制。',
      steps: ['移除远程模块、硬编码 URL、动态请求方法或受保护导出后重新运行。'],
      constraints: ['不得通过别名、动态导入或拼接生产地址绕过静态校验。'],
      verification: ['重新运行 npm run guard:k6，并确认脚本预检通过。'],
    },
  });
}

function relativePath(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function parseScript(source, relative) {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: true,
      plugins: [
        ...(path.extname(relative).toLowerCase() === '.ts' ? ['typescript'] : []),
        'importAttributes',
      ],
      sourceType: 'module',
    });
  } catch (error) {
    throw scriptError(
      'script-parse-failed',
      `无法解析 k6 脚本 ${relative}：${error.reasonCode ?? error.message}`,
      relative,
      { cause: error },
    );
  }
}

function importedName(specifier) {
  if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
    return 'namespace';
  }
  if (specifier.type !== 'ImportSpecifier') return null;
  if (specifier.imported.type === 'Identifier') return specifier.imported.name;
  return specifier.imported.value;
}

function exportedNames(node) {
  const names = [];
  if (node.declaration?.type === 'FunctionDeclaration' || node.declaration?.type === 'ClassDeclaration') {
    if (node.declaration.id?.name) names.push(node.declaration.id.name);
  }
  if (node.declaration?.type === 'VariableDeclaration') {
    for (const declaration of node.declaration.declarations) {
      if (declaration.id.type === 'Identifier') names.push(declaration.id.name);
    }
  }
  for (const specifier of node.specifiers ?? []) {
    if (specifier.exported?.type === 'Identifier') names.push(specifier.exported.name);
    else if (specifier.exported?.type === 'StringLiteral') names.push(specifier.exported.value);
  }
  return names;
}

function localModule(root, importer, source) {
  const target = path.resolve(path.dirname(importer), source);
  const relative = relativePath(root, target);
  const extension = path.extname(target).toLowerCase();
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)
    || !SCRIPT_EXTENSIONS.has(extension)
    || !existsSync(target)
    || !lstatSync(target).isFile()
    || lstatSync(target).isSymbolicLink()) {
    throw scriptError(
      'unsafe-local-module',
      `k6 本地模块必须是仓库内存在的 .js 或 .ts 常规文件：${source}`,
      relative,
      { security: true },
    );
  }
  return Object.freeze({ target, relative });
}

function memberName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
  return null;
}

function environmentReference(node) {
  if (node.object?.type !== 'Identifier' || node.object.name !== '__ENV') return null;
  return memberName(node);
}

function staticMethod(node) {
  if (node?.type === 'StringLiteral') return node.value.toLowerCase();
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked?.toLowerCase() ?? null;
  }
  return null;
}

function containsControlledBaseUrl(node, scope, configuration, visited = new Set()) {
  if (!node) return false;
  if (environmentReference(node) === configuration.target.baseUrlEnv) return true;
  if (node.type === 'Identifier') {
    const binding = scope.getBinding(node.name);
    if (!binding || visited.has(binding)) return false;
    visited.add(binding);
    if (binding.path.isVariableDeclarator()) {
      return containsControlledBaseUrl(
        binding.path.node.init,
        binding.path.scope,
        configuration,
        visited,
      );
    }
    return false;
  }
  if (node.type === 'TemplateLiteral') {
    return node.expressions.some((expression) => (
      containsControlledBaseUrl(expression, scope, configuration, visited)
    ));
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return containsControlledBaseUrl(node.left, scope, configuration, new Set(visited))
      || containsControlledBaseUrl(node.right, scope, configuration, new Set(visited));
  }
  if (node.type === 'ConditionalExpression') {
    return containsControlledBaseUrl(node.consequent, scope, configuration, new Set(visited))
      && containsControlledBaseUrl(node.alternate, scope, configuration, new Set(visited));
  }
  if (node.type === 'TSAsExpression'
    || node.type === 'TSTypeAssertion'
    || node.type === 'TSNonNullExpression'
    || node.type === 'ParenthesizedExpression') {
    return containsControlledBaseUrl(node.expression, scope, configuration, visited);
  }
  return false;
}

function containsRunId(node, scope, visited = new Set()) {
  if (!node) return false;
  if (environmentReference(node) === 'REPO_GUARD_K6_RUN_ID') return true;
  if (node.type !== 'Identifier') return false;
  const binding = scope.getBinding(node.name);
  if (!binding || visited.has(binding) || !binding.path.isVariableDeclarator()) return false;
  visited.add(binding);
  return containsRunId(binding.path.node.init, binding.path.scope, visited);
}

function assertControlledRequestUrl(node, scope, configuration, relative) {
  if (containsControlledBaseUrl(node, scope, configuration)) return;
  throw scriptError(
    'uncontrolled-request-url',
    `k6 脚本 ${relative} 的每个 HTTP 请求地址都必须可追溯到 __ENV.${configuration.target.baseUrlEnv}`,
    relative,
    { security: true },
  );
}

function assertRequestMethod(method, configuration, relative) {
  if (method == null) {
    throw scriptError(
      'dynamic-request-method',
      `k6 脚本 ${relative} 的请求方法必须是可静态验证的字符串`,
      relative,
      { security: true },
    );
  }
  if (SAFE_METHODS.has(method)) return false;
  if (!WRITE_METHODS.has(method)) {
    throw scriptError('unsupported-request-method', `k6 脚本使用了不支持的请求方法：${method}`, relative);
  }
  if (!configuration.safety.allowWrites) {
    throw scriptError(
      'write-request-not-authorized',
      `k6 脚本 ${relative} 包含写请求 ${method.toUpperCase()}，但 safety.allowWrites 未启用`,
      relative,
      { security: true },
    );
  }
  return true;
}

function assertBatchRequest(argument, scope, configuration, relative) {
  if (argument?.type !== 'ArrayExpression') {
    throw scriptError(
      'dynamic-batch-not-supported',
      `k6 脚本 ${relative} 的 http.batch 必须直接使用可静态验证的数组`,
      relative,
      { security: true },
    );
  }
  let foundWrite = false;
  for (const entry of argument.elements) {
    if (!entry) continue;
    if (entry.type === 'StringLiteral' || entry.type === 'TemplateLiteral') {
      assertControlledRequestUrl(entry, scope, configuration, relative);
      continue;
    }
    if (entry.type === 'ArrayExpression') {
      assertControlledRequestUrl(entry.elements[1], scope, configuration, relative);
      foundWrite = assertRequestMethod(
        staticMethod(entry.elements[0]),
        configuration,
        relative,
      ) || foundWrite;
      continue;
    }
    if (entry.type !== 'ObjectExpression') {
      throw scriptError(
        'dynamic-batch-entry',
        `k6 脚本 ${relative} 的 http.batch 包含不可静态验证的请求项`,
        relative,
        { security: true },
      );
    }
    const methodProperty = entry.properties.find((property) => (
      property.type === 'ObjectProperty'
      && ((property.key.type === 'Identifier' && property.key.name === 'method')
        || (property.key.type === 'StringLiteral' && property.key.value === 'method'))
    ));
    const urlProperty = entry.properties.find((property) => (
      property.type === 'ObjectProperty'
      && ((property.key.type === 'Identifier' && property.key.name === 'url')
        || (property.key.type === 'StringLiteral' && property.key.value === 'url'))
    ));
    assertControlledRequestUrl(urlProperty?.value, scope, configuration, relative);
    if (methodProperty) {
      foundWrite = assertRequestMethod(
        staticMethod(methodProperty.value),
        configuration,
        relative,
      ) || foundWrite;
    }
  }
  return foundWrite;
}

function inspectHttpCalls(ast, httpBindings, configuration, relative) {
  let foundWrite = false;
  let foundRequest = false;
  traverse(ast, {
    CallExpression(callPath) {
      const { node } = callPath;
      let method = null;
      if (node.callee.type === 'Identifier' && httpBindings.named.has(node.callee.name)) {
        method = httpBindings.named.get(node.callee.name);
      } else if (node.callee.type === 'MemberExpression'
        && node.callee.object.type === 'Identifier'
        && httpBindings.objects.has(node.callee.object.name)) {
        method = memberName(node.callee);
      }
      if (!method) return;
      const normalizedMethod = method.toLowerCase();
      if (normalizedMethod === 'request') {
        assertControlledRequestUrl(
          node.arguments[1],
          callPath.scope,
          configuration,
          relative,
        );
        foundRequest = true;
        foundWrite = assertRequestMethod(
          staticMethod(node.arguments[0]),
          configuration,
          relative,
        ) || foundWrite;
        return;
      }
      if (normalizedMethod === 'batch') {
        foundRequest = true;
        foundWrite = assertBatchRequest(
          node.arguments[0],
          callPath.scope,
          configuration,
          relative,
        ) || foundWrite;
        return;
      }
      if (!SAFE_METHODS.has(normalizedMethod) && !WRITE_METHODS.has(normalizedMethod)) return;
      assertControlledRequestUrl(
        node.arguments[0],
        callPath.scope,
        configuration,
        relative,
      );
      foundRequest = true;
      foundWrite = assertRequestMethod(normalizedMethod, configuration, relative) || foundWrite;
    },
  });
  return Object.freeze({ foundRequest, foundWrite });
}

function assertHttpBindingUsage(importPath, specifier, imported, relative) {
  const binding = importPath.scope.getBinding(specifier.local.name);
  for (const reference of binding?.referencePaths ?? []) {
    if (imported !== 'namespace') {
      if (reference.parentPath?.isCallExpression()
        && reference.parentPath.node.callee === reference.node) continue;
      throw scriptError(
        'escaped-http-binding',
        `k6 脚本 ${relative} 不得转存或传递 k6/http 请求函数`,
        relative,
        { security: true },
      );
    }
    const memberPath = reference.parentPath;
    const member = memberPath?.isMemberExpression()
      && memberPath.node.object === reference.node
      ? memberName(memberPath.node)
      : null;
    if (member
      && HTTP_OBJECT_MEMBERS.has(member)
      && memberPath.parentPath?.isCallExpression()
      && memberPath.parentPath.node.callee === memberPath.node) continue;
    throw scriptError(
      'dynamic-http-member',
      `k6 脚本 ${relative} 只能直接调用可静态验证的 k6/http 方法`,
      relative,
      { security: true },
    );
  }
}

function inspectTeardown(teardownPath, httpBindings) {
  let hasCleanupWrite = false;
  let usesRunId = false;
  teardownPath.traverse({
    CallExpression(callPath) {
      const { callee } = callPath.node;
      let method = null;
      if (callee.type === 'Identifier' && httpBindings.named.has(callee.name)) {
        method = httpBindings.named.get(callee.name);
      } else if (callee.type === 'MemberExpression'
        && callee.object.type === 'Identifier'
        && httpBindings.objects.has(callee.object.name)) {
        method = memberName(callee);
      }
      if (method === 'request') method = staticMethod(callPath.node.arguments[0]);
      if (method && WRITE_METHODS.has(method.toLowerCase())) hasCleanupWrite = true;
    },
    Identifier(identifierPath) {
      if (containsRunId(identifierPath.node, identifierPath.scope)) usesRunId = true;
    },
    MemberExpression(memberPath) {
      if (environmentReference(memberPath.node) === 'REPO_GUARD_K6_RUN_ID') usesRunId = true;
    },
  });
  return Object.freeze({ hasCleanupWrite, usesRunId });
}

function inspectModule(root, moduleFile, configuration, state) {
  if (state.visited.has(moduleFile.target)) return;
  state.visited.add(moduleFile.target);
  const source = readFileSync(moduleFile.target, 'utf8');
  const ast = parseScript(source, moduleFile.relative);
  const httpBindings = { objects: new Set(), named: new Map() };
  const dependencies = [];
  let teardownPath = null;

  traverse(ast, {
    Import() {
      throw scriptError(
        'dynamic-import-not-supported',
        `k6 脚本 ${moduleFile.relative} 不得使用动态 import()`,
        moduleFile.relative,
        { security: true },
      );
    },
    ImportDeclaration(importPath) {
      const sourceValue = importPath.node.source.value;
      if (sourceValue === 'k6/http') {
        state.foundHttp = true;
        for (const specifier of importPath.node.specifiers) {
          const imported = importedName(specifier);
          if (imported === 'namespace') httpBindings.objects.add(specifier.local.name);
          else if (imported) httpBindings.named.set(specifier.local.name, imported);
          assertHttpBindingUsage(importPath, specifier, imported, moduleFile.relative);
        }
        return;
      }
      if (sourceValue === 'k6' || sourceValue.startsWith('k6/')) {
        if (sourceValue.startsWith('k6/x/')) {
          throw scriptError(
            'extension-not-supported',
            `k6 脚本不得使用自动或自定义扩展：${sourceValue}`,
            moduleFile.relative,
            { security: true },
          );
        }
        return;
      }
      if (!sourceValue.startsWith('./') && !sourceValue.startsWith('../')) {
        throw scriptError(
          'remote-or-bare-module-not-supported',
          `k6 脚本只能导入仓库内相对模块或 k6 内置模块：${sourceValue}`,
          moduleFile.relative,
          { security: true },
        );
      }
      dependencies.push(localModule(root, moduleFile.target, sourceValue));
    },
    ExportNamedDeclaration(exportPath) {
      for (const name of exportedNames(exportPath.node)) {
        if (FORBIDDEN_EXPORTS.has(name)) {
          throw scriptError(
            'protected-export',
            `k6 脚本不得导出 ${name}；该能力由 repo-guard 受控入口提供`,
            moduleFile.relative,
          );
        }
        if (moduleFile.target === configuration.script.target && name === 'teardown') {
          state.hasTeardown = true;
          if (exportPath.get('declaration').isFunctionDeclaration()) {
            teardownPath = exportPath.get('declaration');
          }
        }
      }
      const sourceValue = exportPath.node.source?.value;
      if (sourceValue) {
        if (!sourceValue.startsWith('./') && !sourceValue.startsWith('../')) {
          throw scriptError(
            'unsafe-reexport',
            `k6 脚本不得从非本地模块重新导出：${sourceValue}`,
            moduleFile.relative,
            { security: true },
          );
        }
        dependencies.push(localModule(root, moduleFile.target, sourceValue));
      }
    },
    ExportAllDeclaration(exportPath) {
      const sourceValue = exportPath.node.source.value;
      if (!sourceValue.startsWith('./') && !sourceValue.startsWith('../')) {
        throw scriptError(
          'unsafe-reexport',
          `k6 脚本不得从非本地模块重新导出：${sourceValue}`,
          moduleFile.relative,
          { security: true },
        );
      }
      dependencies.push(localModule(root, moduleFile.target, sourceValue));
    },
    ExportDefaultDeclaration() {
      if (moduleFile.target === configuration.script.target) state.hasDefault = true;
    },
    MemberExpression(memberPath) {
      const name = environmentReference(memberPath.node);
      if (name === configuration.target.baseUrlEnv) state.foundBaseUrlEnvironment = true;
      if (name === 'REPO_GUARD_K6_RUN_ID') state.foundRunIdEnvironment = true;
    },
    StringLiteral(stringPath) {
      if (/https?:\/\//i.test(stringPath.node.value)) {
        throw scriptError(
          'hardcoded-url',
          `k6 脚本 ${moduleFile.relative} 不得硬编码 HTTP 或 HTTPS URL`,
          moduleFile.relative,
          { security: true },
        );
      }
    },
    TemplateElement(templatePath) {
      if (/https?:\/\//i.test(templatePath.node.value.raw)) {
        throw scriptError(
          'hardcoded-url',
          `k6 脚本 ${moduleFile.relative} 不得拼接硬编码 HTTP 或 HTTPS URL`,
          moduleFile.relative,
          { security: true },
        );
      }
    },
  });

  const httpCalls = inspectHttpCalls(
    ast,
    httpBindings,
    configuration,
    moduleFile.relative,
  );
  state.foundRequest = httpCalls.foundRequest || state.foundRequest;
  state.foundWrite = httpCalls.foundWrite || state.foundWrite;
  if (teardownPath) {
    const teardown = inspectTeardown(teardownPath, httpBindings);
    state.teardownHasCleanupWrite = teardown.hasCleanupWrite;
    state.teardownUsesRunId = teardown.usesRunId;
  }
  for (const dependency of dependencies) inspectModule(root, dependency, configuration, state);
}

export function validateK6Script(root, configuration) {
  const state = {
    visited: new Set(),
    foundHttp: false,
    foundBaseUrlEnvironment: false,
    foundRunIdEnvironment: false,
    foundRequest: false,
    foundWrite: false,
    hasDefault: false,
    hasTeardown: false,
    teardownHasCleanupWrite: false,
    teardownUsesRunId: false,
  };
  inspectModule(root, configuration.script, configuration, state);
  if (!state.hasDefault) {
    throw scriptError(
      'missing-default-scenario',
      'k6 入口脚本必须默认导出场景函数',
      configuration.script.relative,
    );
  }
  if (!state.foundHttp) {
    throw scriptError(
      'missing-http-client',
      'k6 脚本必须导入 k6/http 并执行 HTTP 压测',
      configuration.script.relative,
    );
  }
  if (!state.foundRequest) {
    throw scriptError(
      'missing-http-request',
      'k6 脚本必须直接调用至少一个可静态验证的 k6/http 请求方法',
      configuration.script.relative,
    );
  }
  if (!state.foundBaseUrlEnvironment) {
    throw scriptError(
      'missing-controlled-base-url',
      `k6 脚本必须通过 __ENV.${configuration.target.baseUrlEnv} 读取受控目标`,
      configuration.script.relative,
      { security: true },
    );
  }
  if (configuration.safety.allowWrites && !state.foundWrite) {
    throw scriptError(
      'unnecessary-write-authorization',
      'safety.allowWrites 已启用，但脚本没有可静态识别的写请求',
      configuration.script.relative,
    );
  }
  if (state.foundWrite && (
    !state.hasTeardown
    || !state.foundRunIdEnvironment
    || !state.teardownUsesRunId
    || !state.teardownHasCleanupWrite
  )) {
    throw scriptError(
      'incomplete-write-cleanup',
      '写请求脚本必须导出 teardown，并在其中使用 __ENV.REPO_GUARD_K6_RUN_ID 发出可静态验证的清理请求',
      configuration.script.relative,
      { security: true },
    );
  }
  return Object.freeze({
    files: Object.freeze([...state.visited].map((target) => relativePath(root, target)).sort()),
    containsWrites: state.foundWrite,
  });
}
