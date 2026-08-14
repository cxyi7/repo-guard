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
import { createChangeSet } from '../src/core/capability/gate-context.js';
import { collectPrePushChanges } from '../src/pre-push-changes.js';
import {
  ensureUnitTestPolicy,
  isUnitTestPolicyCurrent,
  isUnitTestPolicyManaged,
} from '../src/policies/managed-policies.js';
import {
  analyzeUnitTestContent,
  expectedUnitTestPath,
  expectedUnitTestPaths,
  inspectUnitTestPolicy as inspectUnitTestPolicyWithChangeSet,
  runUnitTestGate as runUnitTestGateWithChangeSet,
  unitTestPolicyFindings,
  validateUnitTestSetup,
} from '../src/unit-test-runner.js';
import { buildManagedTextBlock } from '../src/core/policy/managed-text-block.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function withChangeSet(options) {
  return {
    ...options,
    changes: createChangeSet({
      source: 'test',
      changes: options.changes ?? [],
    }),
  };
}

function inspectUnitTestPolicy(options) {
  return inspectUnitTestPolicyWithChangeSet(withChangeSet(options));
}

function runUnitTestGate(options) {
  return runUnitTestGateWithChangeSet(withChangeSet(options));
}

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
    mappings: DEFAULT_UNIT_TEST_CONFIG.mappings.map((mapping) => ({
      ...mapping,
      testTemplates: [...mapping.testTemplates],
    })),
    exclusions: [...DEFAULT_UNIT_TEST_CONFIG.exclusions],
    componentInteraction: {
      ...DEFAULT_UNIT_TEST_CONFIG.componentInteraction,
      componentPatterns: [
        ...DEFAULT_UNIT_TEST_CONFIG.componentInteraction.componentPatterns,
      ],
    },
    ...extra,
  };
}

function interactiveComponentFixture(root, testSource, componentSource = [
  '<template>',
  '  <input v-model="name">',
  '  <button @click="submit">Save</button>',
  '</template>',
  '<script setup lang="ts">const name = defineModel<string>(); const submit = () => {};</script>',
  '',
].join('\n')) {
  mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'components', 'Editor.vue'), componentSource);
  writeFileSync(path.join(root, 'src', 'components', 'Editor.spec.ts'), testSource);
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
      "import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';",
      "appendFileSync('test-calls.log', `${process.argv.slice(2).join(' ')}\\n`);",
      "if (existsSync('fail-tests')) process.exitCode = 7;",
      "if (existsSync('write-coverage')) {",
      "  mkdirSync('coverage', { recursive: true });",
      "  writeFileSync('coverage/coverage-summary.json', JSON.stringify({ total: {",
      "    lines: { total: 1, covered: 1, pct: 100 },",
      "    statements: { total: 1, covered: 1, pct: 100 },",
      "    functions: { total: 1, covered: 1, pct: 100 },",
      "    branches: { total: 1, covered: 1, pct: 100 },",
      "  } }));",
      "  writeFileSync('coverage/lcov.info', 'SF:src/utils/money.js\\nDA:1,1\\nend_of_record\\n');",
      "}",
      '',
    ].join('\n'),
  );
  return root;
}

function installVueTestUtilsFixture(root) {
  mkdirSync(path.join(root, 'node_modules', '@vue', 'test-utils'), { recursive: true });
  writeFileSync(
    path.join(root, 'node_modules', '@vue', 'test-utils', 'package.json'),
    `${JSON.stringify({
      name: '@vue/test-utils',
      version: '2.4.11',
      type: 'module',
      main: './index.js',
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'node_modules', '@vue', 'test-utils', 'index.js'),
    'export const mount = () => {};\n',
  );
}

test('maps JavaScript, TypeScript, JSX, TSX, and Vue sources to test candidates', () => {
  assert.equal(expectedUnitTestPath('src/utils/money.js'), 'src/utils/money.spec.js');
  assert.equal(expectedUnitTestPath('src/utils/money.mjs'), 'src/utils/money.spec.js');
  assert.equal(expectedUnitTestPath('src/utils/money.cjs'), 'src/utils/money.spec.js');
  assert.equal(expectedUnitTestPath('src/components/Money.jsx'), 'src/components/Money.spec.js');
  assert.equal(
    expectedUnitTestPath('src/components/UserForm/UserForm.vue'),
    'src/components/UserForm/UserForm.spec.js',
  );
  assert.equal(expectedUnitTestPath('src/utils/money.ts'), 'src/utils/money.spec.ts');
  assert.equal(
    expectedUnitTestPath('src/components/Money.tsx'),
    'src/components/Money.spec.tsx',
  );
  assert.equal(
    expectedUnitTestPaths('src/utils/money.ts').includes(
      'src/utils/__tests__/money.test.ts',
    ),
    true,
  );
  assert.throws(
    () => expectedUnitTestPath('src/fixtures/money.json'),
    /source mapping was not found/,
  );
});

test('supports custom mappings and accepts any effective candidate test', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils', '__tests__'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'money.ts'), 'export const money = 1;\n');
  writeFileSync(
    path.join(root, 'src', 'utils', '__tests__', 'money.test.ts'),
    "it('works', () => { expect(1).toBe(1); });\n",
  );

  assert.deepEqual(inspectUnitTestPolicy({
    root,
    changes: [{ status: 'A', oldPath: null, path: 'src/utils/money.ts' }],
    config: unitTestConfig(),
  }).missingTests, []);
  assert.deepEqual(expectedUnitTestPaths('src/services/user.service.ts', [{
    sourcePattern: 'src/services/*.service.ts',
    testTemplates: ['tests/{name}.test.ts'],
  }]), ['tests/user.service.test.ts']);
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
  const [missing] = inspectUnitTestPolicy({
    root,
    changes: changed,
    config: unitTestConfig({ requireTests: 'changedFiles' }),
  }).missingTests;
  assert.equal(missing.sourcePath, 'src/utils/existing.js');
  assert.equal(missing.expectedTestPath, 'src/utils/existing.spec.js');
  assert.equal(missing.reason, 'missing');
  assert.equal(missing.expectedTestPaths.includes('src/utils/existing.test.js'), true);
  assert.deepEqual(unitTestPolicyFindings({
    missingTests: [missing],
    bypasses: [],
    componentInteractions: [],
  })[0], {
    ruleId: 'unit-test/required-test',
    severity: 'error',
    message: 'src/utils/existing.js requires an effective unit test',
    location: { path: 'src/utils/existing.js' },
    evidence: 'Accepted test paths: src/utils/existing.spec.js, src/utils/existing.test.js, src/utils/__tests__/existing.spec.js, src/utils/__tests__/existing.test.js',
    remediation: 'Add an executable test at src/utils/existing.spec.js with meaningful assertions.',
  });

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

test('requires mount, wrapper interaction, and a later outcome assertion for interactive Vue components', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = unitTestConfig({
    componentInteraction: {
      enabled: true,
      componentPatterns: ['src/components/**/*.vue'],
    },
  });
  const changes = [{ status: 'A', oldPath: null, path: 'src/components/Editor.vue' }];

  interactiveComponentFixture(root, [
    "import { mount } from '@vue/test-utils';",
    "import Editor from './Editor.vue';",
    "it('is present', () => { const wrapper = mount(Editor); expect(wrapper.exists()).toBe(true); });",
    '',
  ].join('\n'));
  let [issue] = inspectUnitTestPolicy({ root, changes, config }).componentInteractions;
  assert.equal(issue.analyses[0].mount, true);
  assert.equal(issue.analyses[0].interaction, false);
  assert.equal(issue.analyses[0].assertion, false);

  interactiveComponentFixture(root, [
    "import { mount } from '@vue/test-utils';",
    "import Editor from './Editor.vue';",
    "it('submits', async () => {",
    '  const wrapper = mount(Editor);',
    "  await wrapper.get('input').setValue('Ada');",
    "  await wrapper.get('button').trigger('click');",
    "  expect(wrapper.emitted('submit')).toBeTruthy();",
    '});',
    '',
  ].join('\n'));
  assert.deepEqual(inspectUnitTestPolicy({ root, changes, config }).componentInteractions, []);

  interactiveComponentFixture(root, [
    "import { mount } from '@vue/test-utils';",
    "import Editor from './Editor';",
    "it('updates through an element wrapper', async () => {",
    '  const wrapper = mount(Editor);',
    "  const input = wrapper.get('input');",
    "  await input.setValue('Ada');",
    "  expect(input.attributes('value')).toBe('Ada');",
    '});',
    '',
  ].join('\n'));
  assert.deepEqual(inspectUnitTestPolicy({ root, changes, config }).componentInteractions, []);

  interactiveComponentFixture(root, [
    "import { mount } from '@vue/test-utils';",
    "import Editor from './Editor.vue';",
    "it('shows confirmation', async () => {",
    '  const wrapper = mount(Editor);',
    "  await wrapper.get('button').trigger('click');",
    "  expect(wrapper.find('[role=status]').exists()).toBe(true);",
    '});',
    '',
  ].join('\n'));
  assert.deepEqual(inspectUnitTestPolicy({ root, changes, config }).componentInteractions, []);
});

test('does not require interaction semantics for presentational Vue components', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  interactiveComponentFixture(
    root,
    "it('renders', () => { expect('hello').toContain('hello'); });\n",
    '<template><p>Hello</p></template>\n',
  );
  const result = inspectUnitTestPolicy({
    root,
    changes: [{ status: 'A', oldPath: null, path: 'src/components/Editor.vue' }],
    config: unitTestConfig({
      componentInteraction: {
        enabled: true,
        componentPatterns: ['src/components/**/*.vue'],
      },
    }),
  });
  assert.deepEqual(result.componentInteractions, []);
});

test('accepts test.each and extensionless Vue component aliases', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  interactiveComponentFixture(
    root,
    `import { mount } from '@vue/test-utils';
import Editor from '@/components/Editor';

test.each(['Save'])('emits %s', async () => {
  const wrapper = mount(Editor);
  await wrapper.get('button').trigger('click');
  expect(wrapper.emitted('save')).toHaveLength(1);
});
`,
  );
  const result = inspectUnitTestPolicy({
    root,
    changes: [{ status: 'M', oldPath: null, path: 'src/components/Editor.vue' }],
    config: unitTestConfig({
      componentInteraction: {
        enabled: true,
        componentPatterns: ['src/components/**/*.vue'],
      },
    }),
  });
  assert.deepEqual(result.componentInteractions, []);
});

test('rechecks changed interactive components even in newFiles mode', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  interactiveComponentFixture(root, [
    "import { mount } from '@vue/test-utils';",
    "import Editor from './Editor.vue';",
    "it('exists', () => { expect(mount(Editor).exists()).toBe(true); });",
    '',
  ].join('\n'));
  const result = inspectUnitTestPolicy({
    root,
    changes: [{ status: 'M', oldPath: null, path: 'src/components/Editor.vue' }],
    config: unitTestConfig({
      requireTests: 'newFiles',
      componentInteraction: {
        enabled: true,
        componentPatterns: ['src/components/**/*.vue'],
      },
    }),
  });
  assert.equal(result.missingTests.length, 0);
  assert.equal(result.componentInteractions.length, 1);
});

test('rechecks the mapped component when only its interaction test changes', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  interactiveComponentFixture(root, [
    "import { mount } from '@vue/test-utils';",
    "import Editor from './Editor.vue';",
    "it('exists', () => { expect(mount(Editor).exists()).toBe(true); });",
    '',
  ].join('\n'));
  const result = inspectUnitTestPolicy({
    root,
    changes: [{ status: 'M', oldPath: null, path: 'src/components/Editor.spec.ts' }],
    config: unitTestConfig({
      componentInteraction: {
        enabled: true,
        componentPatterns: ['src/components/**/*.vue'],
      },
    }),
  });
  assert.equal(result.componentInteractions.length, 1);
  assert.equal(result.componentInteractions[0].sourcePath, 'src/components/Editor.vue');
});

test('runs the consuming project script and returns native results', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'money.js'), 'export const money = 1;\n');
  writeFileSync(
    path.join(root, 'src', 'utils', 'money.spec.js'),
    "it('works', () => { expect(1).toBe(1); });\n",
  );

  const passed = runUnitTestGate({
    root,
    config: unitTestConfig(),
    changes: [
      { status: 'A', oldPath: null, path: 'src/utils/money.js' },
      { status: 'A', oldPath: null, path: 'src/utils/money.spec.js' },
    ],
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.diagnostics.some(({ message }) => message.includes('unit-test-fixture')), true);
  assert.equal(readFileSync(path.join(root, 'test-calls.log'), 'utf8'), '\n');

  writeFileSync(path.join(root, 'fail-tests'), 'yes\n');
  const failed = runUnitTestGate({
    root,
    config: unitTestConfig(),
  });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.diagnostics.some(({ message }) => message.includes('unit-test-fixture')), true);
});

test('requires Vue Test Utils only when component interaction semantics are enabled', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = unitTestConfig({
    componentInteraction: {
      enabled: true,
      componentPatterns: ['src/components/**/*.vue'],
    },
  });
  assert.throws(
    () => validateUnitTestSetup(root, config),
    (error) => (
      error?.kind === 'configuration'
      && error?.code === 'project-package/dependency-not-installed'
      && /@vue\/test-utils/.test(error.message)
    ),
  );
  installVueTestUtilsFixture(root);
  assert.equal(validateUnitTestSetup(root, config).vueTestUtils.version, '2.4.11');
});

test('enforces structured global and changed-line coverage after tests pass', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'utils', 'money.js'), 'export const money = 1;\n');
  writeFileSync(
    path.join(root, 'src', 'utils', 'money.spec.js'),
    "it('works', () => { expect(1).toBe(1); });\n",
  );
  writeFileSync(path.join(root, 'write-coverage'), 'yes\n');

  const coverage = {
    enabled: true,
    reportsDirectory: 'coverage',
    thresholds: {
      lines: 80,
      statements: 80,
      functions: 80,
      branches: 80,
      changedLines: 90,
    },
  };
  assert.equal(runUnitTestGate({
    root,
    config: unitTestConfig({ coverage }),
    changes: [
      { status: 'A', oldPath: null, path: 'src/utils/money.js' },
      { status: 'A', oldPath: null, path: 'src/utils/money.spec.js' },
    ],
  }).status, 'passed');
  const args = readFileSync(path.join(root, 'test-calls.log'), 'utf8');
  assert.match(args, /--coverage\.reporter=json-summary/);
  assert.match(args, /--coverage\.reporter=lcov/);
  assert.match(args, /--coverage\.include=src\/utils/);

  rmSync(path.join(root, 'write-coverage'));
  assert.equal(runUnitTestGate({
    root,
    config: unitTestConfig({ coverage }),
    changes: [],
  }).status, 'execution-error');
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

test('adds hard coverage thresholds to the managed AI policy', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = unitTestConfig({
    coverage: {
      enabled: true,
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        changedLines: 90,
      },
    },
  });

  ensureUnitTestPolicy(root, config);
  const content = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /变更行覆盖率不得低于 90%/);
  assert.equal(isUnitTestPolicyCurrent(content, config), true);
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
