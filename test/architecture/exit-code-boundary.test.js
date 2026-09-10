import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';
import { nodeArtifactVerificationProgram } from '../../src/operations/providers/node.js';

const traverse = traverseModule.default ?? traverseModule;
const ROOT = process.cwd();
const EXIT_CODE_MODULE = 'src/core/result/exit-code.js';
const PROCESS_ENTRY = 'bin/repo-guard.js';

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(file);
    return entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}

function propertyName(node) {
  if (!node) return null;
  return node.type === 'Identifier' ? node.name : node.value;
}

function memberName(node) {
  if (!['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)) return null;
  return propertyName(node.property);
}

function isProcessMember(node, property) {
  return node?.object?.type === 'Identifier' && node.object.name === 'process'
    && memberName(node) === property;
}

function functionName(functionPath) {
  if (!functionPath) return null;
  return functionPath.node.id?.name
    ?? (functionPath.parentPath.isVariableDeclarator() ? functionPath.parentPath.node.id.name : null);
}

function isCommandFunction(functionPath, file) {
  if (!functionPath || !file.startsWith('src/orchestration/')) return false;
  const name = functionName(functionPath) ?? '';
  if (/^run[A-Z]/.test(name) || name === 'helpCommand') return true;
  for (let owner = functionPath.parentPath; owner && !owner.isFunction(); owner = owner.parentPath) {
    if (owner.isVariableDeclarator() && owner.node.id.name === 'COMMAND_HANDLERS') return true;
  }
  return false;
}

function returnedValues(node, scope, visited = new Set()) {
  if (node?.type === 'ConditionalExpression') {
    return [...returnedValues(node.consequent, scope, visited), ...returnedValues(node.alternate, scope, visited)];
  }
  if (node?.type === 'LogicalExpression') {
    return [...returnedValues(node.left, scope, visited), ...returnedValues(node.right, scope, visited)];
  }
  if (scope && node?.type === 'Identifier' && !visited.has(node.name)) {
    const binding = scope.getBinding(node.name);
    if (binding?.path.isVariableDeclarator() && binding.constant) {
      return returnedValues(binding.path.node.init, scope, new Set([...visited, node.name]));
    }
  }
  return node ? [node] : [];
}

function isNumericResult(node) {
  return node.type === 'NumericLiteral'
    || (node.type === 'UnaryExpression' && node.argument.type === 'NumericLiteral');
}

function isPublicExitCode(node) {
  return node?.object?.type === 'Identifier' && node.object.name === 'EXIT_CODES'
    && Object.hasOwn(EXIT_CODES, memberName(node));
}

function hasLiteralShellExit(source) {
  return /^\s*exit\s+(['"]?)-?\d+\1\s*;?\s*$/m.test(source);
}

function exitCodeBoundaryViolations(source, file) {
  const violations = [];
  const ast = parse(source, { sourceType: 'module' });
  const report = (node, rule) => violations.push(`${file}:${node.loc?.start.line ?? 1} ${rule}`);
  const inspectNumericMapping = (node, scope) => {
    if (file === EXIT_CODE_MODULE) return;
    if (returnedValues(node, scope).some(isNumericResult)) report(node, '退出码必须复用公共映射');
  };
  const inspectCommandResult = (node, functionPath) => {
    if (!isCommandFunction(functionPath, file)) return;
    inspectNumericMapping(node, functionPath.scope);
    if (returnedValues(node, functionPath.scope).some((value) => memberName(value) === 'status')) {
      report(node, '命令不得透传第三方进程状态');
    }
  };

  traverse(ast, {
    VariableDeclarator(nodePath) {
      const { node } = nodePath;
      if (node.id.type !== 'Identifier') return;
      if (node.id.name === 'EXIT_CODES' && file !== EXIT_CODE_MODULE) report(node, '不得另建退出码表');
      if (node.id.name === 'exitCode' && file.startsWith('src/orchestration/')) {
        inspectNumericMapping(node.init);
      }
    },
    ObjectProperty(nodePath) {
      const { node } = nodePath;
      if (propertyName(node.key) === 'exitCode' && file.startsWith('src/orchestration/')) {
        inspectNumericMapping(node.value);
      }
    },
    AssignmentExpression(nodePath) {
      const { node } = nodePath;
      if (isProcessMember(node.left, 'exitCode')) {
        if (file !== PROCESS_ENTRY) report(node, '只有 bin 入口可以写入进程退出码');
        else if (!isPublicExitCode(node.right)
          && !(node.right.type === 'CallExpression' && node.right.callee.name === 'validateExitCode')) {
          report(node, '进程出口必须校验公共退出码');
        }
      }
      if (file.startsWith('src/orchestration/')
        && (node.left.name === 'exitCode' || memberName(node.left) === 'exitCode')) {
        inspectNumericMapping(node.right);
      }
    },
    CallExpression(nodePath) {
      if (isProcessMember(nodePath.node.callee, 'exit')) {
        report(nodePath.node, '主进程必须经 bin 的统一退出码出口');
      }
    },
    ReturnStatement(nodePath) {
      inspectCommandResult(nodePath.node.argument, nodePath.getFunctionParent());
    },
    ArrowFunctionExpression(nodePath) {
      if (nodePath.node.body.type !== 'BlockStatement') inspectCommandResult(nodePath.node.body, nodePath);
    },
    StringLiteral(nodePath) {
      if (/\bprocess\.(?:exit\s*\(|exitCode\s*=)/.test(nodePath.node.value)
        || hasLiteralShellExit(nodePath.node.value)) {
        report(nodePath.node, '生成脚本必须注入公共退出码');
      }
    },
    TemplateLiteral(nodePath) {
      const { node } = nodePath;
      const template = node.quasis.map((part, index) => (
        `${part.value.cooked ?? part.value.raw}${index < node.expressions.length ? `__injected_${index}` : ''}`
      )).join('');
      const inspectInjectedCode = (expression) => {
        const index = expression?.type === 'Identifier' && /^__injected_(\d+)$/.exec(expression.name)?.[1];
        if (index === false || index == null || !isPublicExitCode(node.expressions[Number(index)])) {
          report(node, '生成脚本必须注入公共退出码');
        }
      };
      if (hasLiteralShellExit(template)) report(node, '生成脚本必须注入公共退出码');
      for (const match of template.matchAll(/^\s*exit\s+(__injected_\d+)\s*;?\s*$/gm)) {
        inspectInjectedCode({ type: 'Identifier', name: match[1] });
      }
      if (!/\bprocess\.(?:exit\s*\(|exitCode\s*=)/.test(template)) return;
      const generated = parse(template, { sourceType: 'script' });
      traverse(generated, {
        CallExpression(generatedPath) {
          if (isProcessMember(generatedPath.node.callee, 'exit')) inspectInjectedCode(generatedPath.node.arguments[0]);
        },
        AssignmentExpression(generatedPath) {
          if (isProcessMember(generatedPath.node.left, 'exitCode')) inspectInjectedCode(generatedPath.node.right);
        },
      });
    },
  });
  return violations;
}

test('keeps command exit codes and the process exit boundary in the shared result module', () => {
  const files = [...javascriptFiles(path.join(ROOT, 'src')), path.join(ROOT, PROCESS_ENTRY)];
  const violations = files.flatMap((file) => exitCodeBoundaryViolations(
    readFileSync(file, 'utf8'), path.relative(ROOT, file).replaceAll('\\', '/'),
  ));
  assert.deepEqual(violations, []);
});

test('rejects local mappings, raw process results, duplicate code tables and process exits', () => {
  const examples = [
    'export function runCheck() { return 0; }',
    'export function runCheck(result) { return result.ok ? 0 : 1; }',
    'export function runCheck(result) { return result.status ?? 1; }',
    'export function runCheck(result) { return result.status; }',
    'export function runCheck(result) { const raw = result.status; return raw; }',
    'export function runCheck() { const code = 2; return code; }',
    'export const runCheck = () => 0;',
    'const COMMAND_HANDLERS = Object.freeze({ check: () => 1 });',
    'const COMMAND_HANDLERS = Object.freeze({ check: () => { return 1; } });',
    'const exitCode = failed ? 2 : 0;',
    'const report = { exitCode: failed ? 3 : 0 };',
    'let result; result.exitCode = 1;',
    'const EXIT_CODES = { success: 0 };',
    'process.exitCode = EXIT_CODES.error;',
    'process["exit"](1);',
    'const script = "process.exit(1);";',
    'const script = `process.exit(${1});`;',
    'const script = "  exit 1";',
    'const script = `exit 2`;',
    'const script = `exit ${1}`;',
  ];
  for (const source of examples) {
    assert.notEqual(exitCodeBoundaryViolations(source, 'src/orchestration/cli/new-command.js').length, 0, source);
  }
  assert.notEqual(exitCodeBoundaryViolations('process.exitCode = result.status;', PROCESS_ENTRY).length, 0);
});

test('allows counts, timeouts, status comparisons and shared code handling', () => {
  const source = [
    'function count(items) { return items.length ? 1 : 0; }',
    'export function runCheck(execution) {',
    'const timeoutMs = 120000;',
    'const successful = execution.status === 0;',
    'const counts = items.map(() => 1);',
    'if (successful) return EXIT_CODES.success;',
    'return gateStatusToExitCode(processExecutionToStatus(execution));',
    '}',
    'const script = `function fail() { process.exit(${EXIT_CODES.error}); }`;',
    'const shell = `  exit ${EXIT_CODES.error}`;',
    'const comment = "# exit 1";',
  ].join('\n');
  assert.deepEqual(exitCodeBoundaryViolations(source, 'src/orchestration/cli/new-command.js'), []);
  assert.deepEqual(exitCodeBoundaryViolations('process.exitCode = validateExitCode(exitCode);', PROCESS_ENTRY), []);
});

test('uses the shared error code in generated operations artifact checks', () => {
  const ast = parse(nodeArtifactVerificationProgram(), { sourceType: 'script' });
  const codes = [];
  traverse(ast, {
    CallExpression(nodePath) {
      if (isProcessMember(nodePath.node.callee, 'exit')) codes.push(nodePath.node.arguments[0].value);
    },
  });
  assert.deepEqual(codes, [EXIT_CODES.error]);
});
