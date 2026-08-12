import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  findDynamicCodeExecution,
  inspectDynamicCode,
  NO_EVAL_RULE,
  NO_FUNCTION_CONSTRUCTOR_RULE,
} from '../src/dynamic-code.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function dateText(offsetDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function registry(entries = []) {
  return { warningDays: 14, maxDays: 90, entries };
}

function exceptionFor(finding, extra = {}) {
  return {
    id: 'reviewed-legacy-runtime',
    rule: finding.rule,
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason: 'Reviewed temporary legacy expression runtime.',
    owner: 'frontend-team',
    approvedBy: 'security-team',
    ticket: 'SEC-2300',
    createdOn: dateText(-1),
    expiresOn: dateText(30),
    ...extra,
  };
}

function createFixture(source, entries = [], file = 'src/runtime.ts') {
  const root = mkdtempSync(path.join(TEST_ROOT, 'dynamic-code-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), source);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry(entries),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('detects direct, indirect, global, bracket, optional, and aliased dynamic execution', () => {
  const source = [
    'eval(payload);',
    '(0, eval)(payload);',
    'window.eval?.(payload);',
    "globalThis['eval'](payload);",
    'const evaluate = eval;',
    'new Function("value", "return value");',
    'Function(source);',
    'self?.Function?.(source);',
    'const Factory = global["Function"];',
  ].join('\n');
  const findings = findDynamicCodeExecution(source, 'src/runtime.ts');
  assert.deepEqual(findings.map(({ rule, line }) => ({ rule, line })), [
    { rule: NO_EVAL_RULE, line: 1 },
    { rule: NO_EVAL_RULE, line: 2 },
    { rule: NO_EVAL_RULE, line: 3 },
    { rule: NO_EVAL_RULE, line: 4 },
    { rule: NO_EVAL_RULE, line: 5 },
    { rule: NO_FUNCTION_CONSTRUCTOR_RULE, line: 6 },
    { rule: NO_FUNCTION_CONSTRUCTOR_RULE, line: 7 },
    { rule: NO_FUNCTION_CONSTRUCTOR_RULE, line: 8 },
    { rule: NO_FUNCTION_CONSTRUCTOR_RULE, line: 9 },
  ]);
});

test('ignores comments, literals, regular expressions, object keys, and Vue non-script blocks', () => {
  const source = [
    '<template><button @click="eval(payload)">Run</button></template>',
    '<script setup lang="ts">',
    '// eval(commented)',
    'const text = "new Function()";',
    'const template = `eval(text)`;',
    'const regex = /eval\\(payload\\)/;',
    'const handlers = { eval: safeHandler, Function: SafeType };',
    'const result = `safe ${eval(payload)}`;',
    '</script>',
    '<style>.eval { color: red }</style>',
  ].join('\n');
  const findings = findDynamicCodeExecution(source, 'src/Panel.vue');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, NO_EVAL_RULE);
  assert.equal(findings[0].line, 8);
});

test('does not reject locally shadowed names or TypeScript type references', () => {
  const source = [
    'type Callback = Function;',
    'function useLocal(eval: (value: string) => string, Function: typeof SafeFactory) {',
    '  const window = { eval: safeParser, Function: SafeFactory };',
    '  eval("value");',
    '  new Function("value");',
    '  window.eval("value");',
    '  return { eval, Function };',
    '}',
  ].join('\n');
  assert.deepEqual(findDynamicCodeExecution(source, 'src/local.ts'), []);
});

test('requires an exact active structured exception', (context) => {
  const source = 'export const run = (source) => new Function(source)();\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const [finding] = findDynamicCodeExecution(source, 'src/runtime.ts');

  const denied = inspectDynamicCode({
    root,
    files: ['src/runtime.ts'],
    exceptions: registry([exceptionFor(finding, { column: finding.column + 1 })]),
  });
  assert.equal(denied.violations.length, 1);
  assert.equal(denied.approved.length, 0);

  const approved = inspectDynamicCode({
    root,
    files: ['src/runtime.ts'],
    exceptions: registry([exceptionFor(finding)]),
  });
  assert.equal(approved.violations.length, 0);
  assert.equal(approved.approved[0].exception.id, 'reviewed-legacy-runtime');
});

test('exposes a full-project CLI with actionable AI repair instructions', (context) => {
  const source = 'export const run = (payload) => window.eval(payload);\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'dynamic-code'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /security\/no-eval/);
  assert.match(result.stderr, /src\/runtime\.ts 第 1 行第 40 列/);
  assert.match(result.stderr, /风险原因/);
  assert.match(result.stderr, /不得改用别名、间接调用/);

  const [finding] = findDynamicCodeExecution(source, 'src/runtime.ts');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry([exceptionFor(finding)]),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  const approved = spawnSync(process.execPath, [CLI_PATH, 'dynamic-code'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stderr, /approved exception.*reviewed-legacy-runtime/);
  assert.match(approved.stdout, /1 approved exception/);
});
