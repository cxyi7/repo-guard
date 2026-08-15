import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { DEFAULT_ACCESSIBILITY_TEST_CONFIG } from '../src/config/defaults.js';
import { createStarterConfig } from '../src/orchestration/setup/config-management.js';
import { runPrePush } from '../src/orchestration/pre-push/runner.js';
import {
  ensureAccessibilityTestPolicy,
  isAccessibilityTestPolicyCurrent,
} from '../src/policies/managed-policies.js';
import {
  analyzeAccessibilityTestContent,
  inspectAccessibilityTestSetup,
} from '../src/gates/testing/accessibility-test-setup.js';
import {
  runAccessibilityTestGate,
} from '../src/gates/testing/accessibility-test-gate.js';

const TEST_ROOT = path.join(tmpdir(), 'repo-guard-accessibility-test');
mkdirSync(TEST_ROOT, { recursive: true });

function config(extra = {}) {
  return {
    ...DEFAULT_ACCESSIBILITY_TEST_CONFIG,
    testPatterns: [...DEFAULT_ACCESSIBILITY_TEST_CONFIG.testPatterns],
    ...extra,
  };
}

function installFixturePackage(root, packageName, version = '1.0.0') {
  const directory = path.join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify({
      name: packageName,
      version,
      type: 'module',
      main: './index.js',
    }, null, 2)}\n`,
  );
  writeFileSync(path.join(directory, 'index.js'), 'export {};\n');
}

function createFixture(source, {
  packageName = 'vitest-axe',
  script = 'node test-a11y.mjs',
} = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'accessibility-test-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.join(root, 'src', '__tests__'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'accessibility-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: script ? { 'test:a11y': script } : {},
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'src', '__tests__', 'Panel.a11y.spec.js'),
    source,
  );
  writeFileSync(
    path.join(root, 'test-a11y.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "appendFileSync('a11y-calls.log', 'run\\n');",
      "if (existsSync('fail-a11y')) process.exitCode = 7;",
      '',
    ].join('\n'),
  );
  if (packageName) installFixturePackage(root, packageName, '4.1.0');
  return root;
}

test('recognizes supported axe integrations with real scans and zero-violation assertions', () => {
  const cases = [
    [
      "import { axe, toHaveNoViolations } from 'vitest-axe';\ntest('a11y', async () => { expect(await axe(wrapper.element)).toHaveNoViolations(); });",
      'vitest-axe',
    ],
    [
      "import AxeBuilder from '@axe-core/playwright';\ntest('a11y', async () => { const results = await new AxeBuilder({ page }).analyze(); expect(results.violations).toEqual([]); });",
      'playwright',
    ],
    [
      "import 'cypress-axe';\nit('a11y', () => { cy.injectAxe(); cy.checkA11y(); });",
      'cypress',
    ],
    [
      "import axe from 'axe-core';\ntest('a11y', async () => { const results = await axe.run(document); expect(results.violations).toHaveLength(0); });",
      'axe-core',
    ],
  ];
  for (const [source, expected] of cases) {
    const result = analyzeAccessibilityTestContent(source);
    assert.equal(result.integration, expected);
    assert.equal(result.hasTestCase, true);
    assert.equal(result.scan, true);
    assert.equal(result.assertion, true);
    assert.deepEqual(result.bypasses, []);
  }
});

test('rejects disabled rules, excluded DOM, impact filtering, and skipped tests', () => {
  const source = [
    "import AxeBuilder from '@axe-core/playwright';",
    "test.skip('a11y', async () => {",
    '  const results = await new AxeBuilder({ page })',
    "    .disableRules(['color-contrast'])",
    "    .exclude('#legacy')",
    "    .withRules(['button-name'])",
    "    .withTags(['wcag2a'])",
    "    .options({ runOnly: ['button-name'], includedImpacts: ['critical'] })",
    '    .analyze();',
    '  expect(results.violations).toEqual([]);',
    '});',
  ].join('\n');
  const result = analyzeAccessibilityTestContent(source);
  assert.deepEqual(result.bypasses.map(({ expression }) => expression), [
    'test.skip',
    'disableRules',
    'exclude',
    'withRules',
    'withTags',
    'runOnly',
    'includedImpacts',
  ]);
});

test('does not accept axe scans, assertions, or bypasses written only in strings', () => {
  const source = [
    "import { axe } from 'vitest-axe';",
    "test('a11y', () => {",
    "  const fake = 'axe(document); expect(results).toHaveNoViolations(); .disableRules()';",
    '  expect(fake).toBeTruthy();',
    '});',
  ].join('\n');
  const result = analyzeAccessibilityTestContent(source);
  assert.equal(result.integration, 'vitest-axe');
  assert.equal(result.scan, false);
  assert.equal(result.assertion, false);
  assert.deepEqual(result.bypasses, []);
});

test('only treats enabled false as a bypass inside an axe rules object', () => {
  const safeSource = [
    "import { axe } from 'vitest-axe';",
    "test('a11y', async () => {",
    '  const feature = { enabled: false };',
    '  expect(await axe(document.body)).toHaveNoViolations();',
    '  expect(feature.enabled).toBe(false);',
    '});',
  ].join('\n');
  assert.deepEqual(analyzeAccessibilityTestContent(safeSource).bypasses, []);

  const bypassSource = safeSource.replace(
    'const feature = { enabled: false };',
    "const options = { rules: { region: { enabled: false } } };",
  );
  assert.deepEqual(
    analyzeAccessibilityTestContent(bypassSource).bypasses.map(({ expression }) => expression),
    ['axe rule enabled: false'],
  );
});

test('inspects every configured file and requires installed integrations', (context) => {
  const valid = "import { axe } from 'vitest-axe';\ntest('a11y', async () => { expect(await axe(document.body)).toHaveNoViolations(); });\n";
  const root = createFixture(valid);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const passed = inspectAccessibilityTestSetup(root, config());
  assert.deepEqual(passed.problems, []);
  assert.deepEqual(passed.integrations, [{ name: 'vitest-axe', version: '4.1.0' }]);

  writeFileSync(
    path.join(root, 'src', '__tests__', 'Broken.a11y.spec.js'),
    "import { axe } from 'vitest-axe';\ntest('a11y', async () => { await axe(document.body); });\n",
  );
  const denied = inspectAccessibilityTestSetup(root, config());
  assert.equal(
    denied.problems.some(({ code, path: filePath }) => (
      code === 'missing-zero-violation-assertion'
      && filePath.endsWith('Broken.a11y.spec.js')
    )),
    true,
  );
});

test('rejects an obvious no-op accessibility test script', (context) => {
  const source = "import { axe } from 'vitest-axe';\ntest('a11y', async () => { expect(await axe(document.body)).toHaveNoViolations(); });\n";
  const root = createFixture(source, { script: 'echo accessibility passed' });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = inspectAccessibilityTestSetup(root, config());
  assert.equal(result.problems.some(({ code }) => code === 'no-op-script'), true);
});

test('runs the project accessibility script and blocks failures', (context) => {
  const source = "import { axe } from 'vitest-axe';\ntest('a11y', async () => { expect(await axe(document.body)).toHaveNoViolations(); });\n";
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const passed = runAccessibilityTestGate({ root, config: config() });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.diagnostics.some(({ message }) => message.includes('accessibility-fixture')), true);
  assert.equal(readFileSync(path.join(root, 'a11y-calls.log'), 'utf8'), 'run\n');

  writeFileSync(path.join(root, 'fail-a11y'), 'yes\n');
  const failed = runAccessibilityTestGate({ root, config: config() });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.diagnostics.some(({ message }) => message.includes('accessibility-fixture')), true);
});

test('runs enabled accessibility tests from pre-push', async (context) => {
  const source = "import { axe } from 'vitest-axe';\ntest('a11y', async () => { expect(await axe(document.body)).toHaveNoViolations(); });\n";
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const projectConfig = createStarterConfig({ accessibilityTestEnabled: true });
  projectConfig.notification.enabled = false;
  projectConfig.preCommit.eslint.enabled = false;
  projectConfig.preCommit.prettier.enabled = false;
  projectConfig.preCommit.filePlacement.enabled = false;
  projectConfig.preCommit.maxFileLines.enabled = false;
  projectConfig.dependencyPolicy.enabled = false;
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(projectConfig, null, 2)}\n`,
  );
  ensureAccessibilityTestPolicy(root, projectConfig.accessibilityTest);
  assert.equal(spawnSync('git', ['config', 'user.name', 'repo-guard test'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 'repo-guard@example.invalid'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-m', 'fixture'], { cwd: root }).status, 0);

  assert.equal(await runPrePush(root), 0);
  assert.equal(readFileSync(path.join(root, 'a11y-calls.log'), 'utf8'), 'run\n');
});

test('maintains an idempotent AI accessibility testing policy', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'accessibility-policy-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'AGENTS.md'), '# Existing\n');

  assert.equal(ensureAccessibilityTestPolicy(root, config()).changed, true);
  const content = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /axe 可访问性测试硬性要求/);
  assert.match(content, /disableRules、exclude、withRules、withTags、runOnly、includedImpacts/);
  assert.equal(isAccessibilityTestPolicyCurrent(content, config()), true);
  assert.equal(ensureAccessibilityTestPolicy(root, config()).changed, false);
});
