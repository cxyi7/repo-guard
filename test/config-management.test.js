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

test('starter configuration enables both gates and all protected rules', () => {
  const config = createStarterConfig();

  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.eslint.fix, true);
  assert.equal(config.preCommit.prettier.enabled, true);
  assert.equal(config.preCommit.prettier.fix, true);
  assert.equal(config.rules.length, 9);
  assert.equal(config.rules.every(({ level }) => level === 'notify'), true);
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
  assert.equal(migrated.preCommit.prettier.enabled, false);
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

  const result = enableQualityGates(root, ['eslint', 'prettier', 'eslint']);
  const config = readConfig(root);

  assert.deepEqual(result.enabled, ['eslint', 'prettier']);
  assert.equal(config.preCommit.eslint.enabled, true);
  assert.equal(config.preCommit.prettier.enabled, true);
  assert.equal(config.preCommit.prettier.requireConfig, false);
});

test('rejects unsupported gates without rewriting configuration', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(
    () => enableQualityGates(root, ['stylelint']),
    /Unsupported quality gate/,
  );
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
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
