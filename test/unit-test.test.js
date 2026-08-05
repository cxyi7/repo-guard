import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DEFAULT_UNIT_TEST_CONFIG } from '../src/config.js';
import { collectPrePushChanges } from '../src/pre-push-changes.js';
import {
  ensureUnitTestPolicy,
  isUnitTestPolicyCurrent,
  isUnitTestPolicyManaged,
} from '../src/unit-test-policy.js';
import {
  analyzeUnitTestContent,
  expectedUnitTestPath,
  inspectUnitTestPolicy,
  runUnitTestGate,
} from '../src/unit-test-runner.js';
import { buildManagedTextBlock } from '../src/managed-text-block.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function unitTestConfig(extra = {}) {
  return {
    ...DEFAULT_UNIT_TEST_CONFIG,
    sourcePatterns: [...DEFAULT_UNIT_TEST_CONFIG.sourcePatterns],
    testPatterns: [...DEFAULT_UNIT_TEST_CONFIG.testPatterns],
    exclusions: [...DEFAULT_UNIT_TEST_CONFIG.exclusions],
    ...extra,
  };
}

function createFixture() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'unit-test-'));
  mkdirSync(path.join(root, 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'unit-test-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { 'test:unit': 'node test-unit.mjs' },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'node_modules', 'vitest', 'package.json'),
    `${JSON.stringify({
      name: 'vitest',
      version: '4.0.0',
      type: 'module',
      main: './index.js',
    }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'node_modules', 'vitest', 'index.js'), 'export {};\n');
  writeFileSync(
    path.join(root, 'test-unit.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "appendFileSync('test-calls.log', `${process.argv.slice(2).join(' ')}\\n`);",
      "if (existsSync('fail-tests')) process.exitCode = 7;",
      '',
    ].join('\n'),
  );
  return root;
}

test('maps JavaScript and Vue source files to colocated spec files', () => {
  assert.equal(expectedUnitTestPath('src/utils/money.js'), 'src/utils/money.spec.js');
  assert.equal(expectedUnitTestPath('src/utils/money.mjs'), 'src/utils/money.spec.js');
  assert.equal(expectedUnitTestPath('src/utils/money.cjs'), 'src/utils/money.spec.js');
  assert.equal(expectedUnitTestPath('src/components/Money.jsx'), 'src/components/Money.spec.js');
  assert.equal(
    expectedUnitTestPath('src/components/UserForm/UserForm.vue'),
    'src/components/UserForm/UserForm.spec.js',
  );
  assert.throws(
    () => expectedUnitTestPath('src/fixtures/money.json'),
    /source extension is not supported/,
  );
});

test('ignores test-like text in comments, strings, templates, and regular expressions', () => {
  const analysis = analyzeUnitTestContent([
    "// test('commented', () => {})",
    "const message = 'test.skip';",
    'const template = `it.only`;',
    'const pattern = /describe\\.only/;',
    'function createPattern() { return /test\\.skip/; }',
    '',
  ].join('\n'));

  assert.equal(analysis.hasTestCase, false);
  assert.deepEqual(analysis.bypasses, []);
});

test('treats todo and conditional skips as explicit test bypasses', () => {
  const analysis = analyzeUnitTestContent([
    "test.todo('later');",
    "test.skipIf(true)('disabled', () => {});",
    "test.each([]).only('focused', () => {});",
    '',
  ].join('\n'));

  assert.equal(analysis.hasTestCase, true);
  assert.deepEqual(
    analysis.bypasses.map(({ expression }) => expression),
    ['test.todo', 'test.skipIf', 'test.only'],
  );
});

test('reports missing tests for new files and supports stricter changed files mode', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'existing.js'), 'export const value = 1;\n');

  const changed = [{ status: 'M', oldPath: null, path: 'src/utils/existing.js' }];
  assert.equal(
    inspectUnitTestPolicy({
      root,
      changes: changed,
      config: unitTestConfig(),
    }).missingTests.length,
    0,
  );
  assert.deepEqual(
    inspectUnitTestPolicy({
      root,
      changes: changed,
      config: unitTestConfig({ requireTests: 'changedFiles' }),
    }).missingTests,
    [{
      sourcePath: 'src/utils/existing.js',
      expectedTestPath: 'src/utils/existing.spec.js',
      reason: 'missing',
    }],
  );

  writeFileSync(path.join(root, 'src', 'utils', 'existing.spec.js'), '// TODO\n');
  assert.equal(
    inspectUnitTestPolicy({
      root,
      changes: changed,
      config: unitTestConfig({ requireTests: 'changedFiles' }),
    }).missingTests[0].reason,
    'empty',
  );
});

test('rejects only and skip bypasses in changed spec files', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'utils', 'money.spec.js'),
    "describe.only('money', () => { it.skip('works', () => {}); test.only.each([])('x', () => {}); });\n",
  );

  const result = inspectUnitTestPolicy({
    root,
    changes: [{ status: 'A', oldPath: null, path: 'src/utils/money.spec.js' }],
    config: unitTestConfig(),
  });
  assert.equal(result.bypasses.length, 3);
  assert.deepEqual(result.bypasses.map(({ line }) => line), [1, 1, 1]);
});

test('rejects a changed empty spec even without a matching source change', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'placeholder.spec.js'), '// TODO\n');

  const result = inspectUnitTestPolicy({
    root,
    changes: [{ status: 'A', oldPath: null, path: 'src/utils/placeholder.spec.js' }],
    config: unitTestConfig(),
  });
  assert.deepEqual(result.missingTests, [{
    sourcePath: null,
    expectedTestPath: 'src/utils/placeholder.spec.js',
    reason: 'empty',
  }]);
});

test('runs the consuming project script and forwards the coverage switch', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'money.js'), 'export const money = 1;\n');
  writeFileSync(
    path.join(root, 'src', 'utils', 'money.spec.js'),
    "it('works', () => { expect(1).toBe(1); });\n",
  );

  assert.equal(runUnitTestGate({
    root,
    config: unitTestConfig({ coverage: true }),
    changes: [
      { status: 'A', oldPath: null, path: 'src/utils/money.js' },
      { status: 'A', oldPath: null, path: 'src/utils/money.spec.js' },
    ],
  }), 0);
  assert.equal(readFileSync(path.join(root, 'test-calls.log'), 'utf8'), '--coverage\n');

  writeFileSync(path.join(root, 'fail-tests'), 'yes\n');
  assert.equal(runUnitTestGate({
    root,
    config: unitTestConfig(),
  }), 7);
});

test('maintains an idempotent AGENTS unit test policy without replacing project text', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'AGENTS.md'), '# Project instructions\n');

  const first = ensureUnitTestPolicy(root);
  const content = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const second = ensureUnitTestPolicy(root);

  assert.equal(first.changed, true);
  assert.equal(first.created, false);
  assert.equal(second.changed, false);
  assert.match(content, /^# Project instructions/m);
  assert.equal(isUnitTestPolicyManaged(content), true);
  assert.equal(isUnitTestPolicyCurrent(content, unitTestConfig()), true);
  assert.equal(
    isUnitTestPolicyCurrent(content, unitTestConfig({ script: 'test:changed' })),
    false,
  );
});

test('preserves matching human-authored lines when adding a managed text block', () => {
  const output = buildManagedTextBlock({
    current: '# Manual policy\n## 前端单元测试要求\nKeep this explanation attached.\n',
    startMarker: '<!-- managed:start -->',
    endMarker: '<!-- managed:end -->',
    managedLines: ['## 前端单元测试要求'],
    target: 'AGENTS.md',
  });

  assert.match(
    output,
    /# Manual policy\n## 前端单元测试要求\nKeep this explanation attached\./,
  );
  assert.equal(output.match(/## 前端单元测试要求/g).length, 2);
});

test('collects the exact committed range supplied by the pre-push hook', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'money.js'), 'export const money = 1;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'feature']);
  const head = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(
    path.join(root, 'src', 'utils', 'money.spec.js'),
    "it('untracked', () => { expect(1).toBe(1); });\n",
  );
  const input = `refs/heads/main ${head} refs/heads/main ${base}\n`;

  const changes = collectPrePushChanges({ input, remoteName: 'origin', root });
  assert.deepEqual(
    changes.map(({ path: filePath }) => filePath).sort(),
    ['src/utils/money.js'],
  );
  const policy = inspectUnitTestPolicy({
    root,
    changes,
    config: unitTestConfig(),
  });
  assert.equal(policy.missingTests[0].reason, 'missing');
  assert.equal(existsSync(path.join(root, 'AGENTS.md')), false);
});

test('keeps same-path changes from different pushed commits separate', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'shared.js'), 'export const value = 0;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '-c', 'first']);
  writeFileSync(path.join(root, 'src', 'shared.js'), 'export const value = 1;\n');
  git(root, ['add', 'src/shared.js']);
  git(root, ['commit', '-m', 'first']);
  const first = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '-c', 'second', base]);
  writeFileSync(path.join(root, 'src', 'shared.js'), 'export const value = 2;\n');
  git(root, ['add', 'src/shared.js']);
  git(root, ['commit', '-m', 'second']);
  const second = git(root, ['rev-parse', 'HEAD']);

  const changes = collectPrePushChanges({
    root,
    remoteName: 'origin',
    input: [
      `refs/heads/first ${first} refs/heads/first ${base}`,
      `refs/heads/second ${second} refs/heads/second ${base}`,
      '',
    ].join('\n'),
  });
  assert.equal(changes.length, 2);
  assert.deepEqual(new Set(changes.map(({ headSha }) => headSha)), new Set([first, second]));
});
