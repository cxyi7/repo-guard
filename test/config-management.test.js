import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createStarterConfig,
  enableQualityGates,
  migrateProjectConfig,
  setFeaturesEnabled,
} from '../src/config-management.js';
import { CONFIG_FILE } from '../src/config.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function createFixture(config) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'config-management-'));
  writeFileSync(
    path.join(root, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return root;
}

function readConfig(root) {
  return JSON.parse(readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
}

function sparseConfig(extra = {}) {
  return {
    version: 1,
    rules: [
      {
        pattern: 'src/**',
        category: 'Source',
        level: 'audit',
      },
    ],
    ...extra,
  };
}

test('starter configuration enables standard gates and leaves Stylelint opt-in', () => {
  const config = createStarterConfig();

  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.eslint.preset, true);
  assert.equal(config.preCommit.eslint.fix, true);
  assert.equal(config.preCommit.prettier.enabled, true);
  assert.equal(config.preCommit.prettier.fix, true);
  assert.equal(config.preCommit.stylelint.enabled, false);
  assert.equal(config.preCommit.maxFileLines.enabled, true);
  assert.equal(config.preCommit.maxFileLines.mode, 'strict');
  assert.equal(config.preCommit.maxFileLines.warnAt, 0.85);
  assert.deepEqual(config.preCommit.maxFileLines.rules, [
    { pattern: '**/*.vue', maxLines: 700 },
    { pattern: '**/*.{js,mjs,cjs,jsx}', maxLines: 1000 },
    { pattern: '**/*.{ts,tsx}', maxLines: 1000 },
  ]);
  assert.equal(config.lighthouse.enabled, false);
  assert.equal(config.unitTest.enabled, false);
  assert.equal(config.unitTest.requireTests, 'newFiles');
  assert.equal(config.notification.enabled, true);
  assert.equal(config.rules.length, 9);
  assert.equal(config.rules.every(({ level }) => level === 'notify'), true);
});

test('starter configuration enables Stylelint when project setup was detected', () => {
  const config = createStarterConfig({ stylelintEnabled: true });

  assert.equal(config.preCommit.stylelint.enabled, true);
});

test('starter configuration enables unit tests when project setup was detected', () => {
  const config = createStarterConfig({ unitTestEnabled: true });

  assert.equal(config.unitTest.enabled, true);
  assert.equal(config.unitTest.script, 'test:unit');
});

test('migrates sparse configuration without changing project rules', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const first = migrateProjectConfig(root);
  const migrated = readConfig(root);

  assert.equal(first.changed, true);
  assert.deepEqual(migrated.rules, sparseConfig().rules);
  assert.deepEqual(migrated.exclusions, []);
  assert.equal(migrated.preCommit.eslint.enabled, false);
  assert.equal(migrated.preCommit.eslint.preset, false);
  assert.equal(migrated.preCommit.prettier.enabled, false);
  assert.equal(migrated.preCommit.stylelint.enabled, false);
  assert.equal(migrated.preCommit.maxFileLines.enabled, false);
  assert.equal(migrated.preCommit.maxFileLines.mode, 'strict');
  assert.equal(migrated.preCommit.maxFileLines.warnAt, 0.85);
  assert.equal(migrated.lighthouse.enabled, false);
  assert.equal(migrated.unitTest.enabled, false);
  assert.equal(migrated.notification.enabled, true);
  assert.match(migrated.$schema, /repo-guard\/config\.schema\.json$/);

  const second = migrateProjectConfig(root);
  assert.equal(second.changed, false);
});

test('enables selected quality gates and preserves explicit settings', (context) => {
  const root = createFixture(sparseConfig({
    preCommit: {
      prettier: {
        requireConfig: false,
      },
    },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = enableQualityGates(root, ['eslint', 'prettier', 'stylelint', 'eslint']);
  const config = readConfig(root);

  assert.deepEqual(result.enabled, ['eslint', 'prettier', 'stylelint']);
  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.prettier.enabled, true);
  assert.equal(config.preCommit.prettier.requireConfig, false);
  assert.equal(config.preCommit.stylelint.enabled, true);
});

test('rejects unsupported gates without rewriting configuration', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(
    () => enableQualityGates(root, ['biome']),
    /Unsupported quality gate/,
  );
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});

test('disables and re-enables project notification', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const disabled = setFeaturesEnabled(root, ['notification'], false);
  assert.deepEqual(disabled.changed, ['notification']);
  assert.equal(readConfig(root).notification.enabled, false);

  const enabled = setFeaturesEnabled(root, ['notification'], true);
  assert.deepEqual(enabled.changed, ['notification']);
  assert.equal(readConfig(root).notification.enabled, true);
});

test('enables the Vue Lighthouse pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['lighthouse'], true);
  assert.deepEqual(enabled.changed, ['lighthouse']);
  assert.equal(readConfig(root).lighthouse.enabled, true);
});

test('enables the unit test pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['unitTest'], true);
  assert.deepEqual(enabled.changed, ['unitTest']);
  assert.equal(readConfig(root).unitTest.enabled, true);
});

test('enables the maximum file lines pre-commit feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['maxFileLines'], true);
  assert.deepEqual(enabled.changed, ['maxFileLines']);
  assert.equal(readConfig(root).preCommit.maxFileLines.enabled, true);
});

test('rejects invalid values before migration can rewrite the file', (context) => {
  const root = createFixture(sparseConfig({
    preCommit: {
      eslint: {
        maxWarnings: -1,
      },
    },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(() => migrateProjectConfig(root), /non-negative integer/);
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});
