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
} from '../src/orchestration/setup/config-management.js';
import { CONFIG_FILE } from '../src/config/validation-primitives.js';

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
  assert.equal(config.preCommit.stylelint.complexity.enabled, false);
  assert.equal(config.preCommit.stylelint.governance.enabled, false);
  assert.equal(config.preCommit.filePlacement.enabled, true);
  assert.equal(config.preCommit.filePlacement.mode, 'newFiles');
  assert.equal(config.preCommit.filePlacement.rules.length, 2);
  assert.equal(config.codePlacement.enabled, false);
  assert.deepEqual(config.codePlacement.rules, []);
  assert.equal(config.preCommit.maxFileLines.enabled, true);
  assert.equal(config.preCommit.maxFileLines.mode, 'strict');
  assert.equal(config.preCommit.maxFileLines.warnAt, 0.85);
  assert.deepEqual(config.preCommit.maxFileLines.rules, [
    { pattern: '**/*.vue', maxLines: 700 },
    { pattern: '**/*.{js,mjs,cjs,jsx}', maxLines: 1000 },
    { pattern: '**/*.{ts,tsx}', maxLines: 1000 },
  ]);
  assert.equal(config.lighthouse.enabled, false);
  assert.equal(config.dependencyPolicy.enabled, true);
  assert.equal(config.architecture.enabled, false);
  assert.equal(config.accessibilityTest.enabled, false);
  assert.equal(config.architecture.rules.length, 3);
  assert.equal(config.build.enabled, false);
  assert.equal(config.typeCheck.enabled, false);
  assert.equal(config.unitTest.enabled, false);
  assert.equal(config.unitTest.requireTests, 'newFiles');
  assert.equal(config.unitTest.componentInteraction.enabled, false);
  assert.equal(config.unitTest.mappings.length, 5);
  assert.equal(config.notification.enabled, true);
  assert.equal(config.ci.enabled, false);
  assert.equal(config.ci.profile, 'policy');
  assert.equal(config.ci.reportPath, 'reports/repo-guard.json');
  assert.deepEqual(config.ci.gatePolicy, { defaultMode: 'inherit', gates: {} });
  assert.deepEqual(config.ci.pipeline, {
    enabled: false,
    verifyStage: 'build',
    deployStage: 'deploy',
    verifyImage: 'node:22.23.2',
    deployImage: 'node:22.23.2',
    testBranches: ['dev'],
    productionBranches: ['publish'],
    runnerTags: ['docker'],
    legacyPeerDeps: false,
    quickDeploy: false,
    notifications: false,
  });
  assert.deepEqual(config.externalGates, []);
  assert.deepEqual(config.exceptions, {
    warningDays: 14,
    maxDays: 90,
    entries: [],
  });
  assert.equal(config.dependencyPolicy.enabled, true);
  assert.equal(config.dependencyPolicy.requireExactVersions, true);
  assert.deepEqual(config.dependencyPolicy.allowedProtocols, ['npm', 'workspace']);
  assert.equal(config.rules.length, 9);
  assert.equal(config.rules.every(({ level }) => level === 'notify'), true);
});

test('starter configuration enables Stylelint when project setup was detected', () => {
  const config = createStarterConfig({ stylelintEnabled: true });

  assert.equal(config.preCommit.stylelint.enabled, true);
  assert.equal(config.preCommit.stylelint.complexity.enabled, true);
  assert.equal(config.preCommit.stylelint.governance.enabled, true);
});

test('starter configuration enables build when its project script was detected', () => {
  const config = createStarterConfig({ buildEnabled: true });

  assert.equal(config.build.enabled, true);
  assert.equal(config.build.script, 'build');
});

test('starter configuration enables architecture when dependency-cruiser was detected', () => {
  const config = createStarterConfig({ architectureEnabled: true });

  assert.equal(config.architecture.enabled, true);
  assert.deepEqual(config.architecture.sourcePaths, ['src']);
});

test('starter configuration enables unit tests when project setup was detected', () => {
  const config = createStarterConfig({ unitTestEnabled: true });

  assert.equal(config.unitTest.enabled, true);
  assert.equal(config.unitTest.componentInteraction.enabled, false);
  assert.equal(config.unitTest.script, 'test:unit');
});

test('starter configuration enables axe accessibility tests when setup was detected', () => {
  const config = createStarterConfig({ accessibilityTestEnabled: true });

  assert.equal(config.accessibilityTest.enabled, true);
  assert.equal(config.accessibilityTest.script, 'test:a11y');
  assert.equal(config.accessibilityTest.testPatterns.length, 2);
});

test('starter configuration enables TypeScript when its project script was detected', () => {
  const config = createStarterConfig({ typeCheckEnabled: true });

  assert.equal(config.typeCheck.enabled, true);
  assert.equal(config.typeCheck.script, 'typecheck');
});

test('migrates sparse configuration without changing project rules', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const first = migrateProjectConfig(root);
  const migrated = readConfig(root);

  assert.equal(first.changed, true);
  assert.deepEqual(migrated.rules, sparseConfig().rules);
  assert.deepEqual(migrated.externalGates, []);
  assert.deepEqual(migrated.exclusions, []);
  assert.equal(migrated.preCommit.eslint.enabled, true);
  assert.equal(migrated.preCommit.eslint.preset, true);
  assert.equal(migrated.preCommit.prettier.enabled, true);
  assert.equal(migrated.preCommit.stylelint.enabled, false);
  assert.equal(migrated.preCommit.stylelint.governance.enabled, false);
  assert.equal(migrated.preCommit.filePlacement.enabled, true);
  assert.equal(migrated.preCommit.filePlacement.rules.length, 2);
  assert.equal(migrated.preCommit.maxFileLines.enabled, true);
  assert.equal(migrated.preCommit.maxFileLines.mode, 'strict');
  assert.equal(migrated.preCommit.maxFileLines.warnAt, 0.85);
  assert.equal(migrated.lighthouse.enabled, false);
  assert.equal(migrated.architecture.enabled, false);
  assert.equal(migrated.accessibilityTest.enabled, false);
  assert.equal(migrated.architecture.rules.length, 3);
  assert.equal(migrated.build.enabled, false);
  assert.equal(migrated.typeCheck.enabled, false);
  assert.equal(migrated.unitTest.enabled, false);
  assert.equal(migrated.unitTest.componentInteraction.enabled, false);
  assert.equal(migrated.unitTest.mappings.length, 5);
  assert.equal(migrated.notification.enabled, true);
  assert.deepEqual(migrated.ci.gatePolicy, { defaultMode: 'inherit', gates: {} });
  assert.deepEqual(migrated.exceptions.entries, []);
  assert.equal(migrated.dependencyPolicy.enabled, true);
  assert.match(migrated.$schema, /repo-guard\/config\.schema\.json$/);

  const second = migrateProjectConfig(root);
  assert.equal(second.changed, false);
});

test('rejects legacy boolean coverage during migration', (context) => {
  const root = createFixture(sparseConfig({
    unitTest: { coverage: true },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(() => migrateProjectConfig(root), /unitTest\.coverage 必须是对象/);
});

test('enables selected quality gates and preserves explicit settings', (context) => {
  const root = createFixture(sparseConfig({
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false, requireConfig: false },
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
    /不支持的质量门禁/,
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

test('enables component interaction with unit tests and disables both consistently', (context) => {
  const root = createFixture(sparseConfig({ unitTest: { enabled: false } }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['componentInteraction'], true);
  assert.deepEqual(enabled.changed, ['unitTest', 'componentInteraction']);
  let config = readConfig(root);
  assert.equal(config.unitTest.enabled, true);
  assert.equal(config.unitTest.componentInteraction.enabled, true);

  const disabled = setFeaturesEnabled(root, ['unitTest'], false);
  assert.deepEqual(disabled.changed, ['componentInteraction', 'unitTest']);
  config = readConfig(root);
  assert.equal(config.unitTest.enabled, false);
  assert.equal(config.unitTest.componentInteraction.enabled, false);
});

test('enables the axe accessibility test pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['accessibilityTest'], true);
  assert.deepEqual(enabled.changed, ['accessibilityTest']);
  assert.equal(readConfig(root).accessibilityTest.enabled, true);
});

test('enables the architecture pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['architecture'], true);
  assert.deepEqual(enabled.changed, ['architecture']);
  assert.equal(readConfig(root).architecture.enabled, true);
});

test('enables the dependency governance pre-commit feature', (context) => {
  const root = createFixture(sparseConfig({ dependencyPolicy: { enabled: false } }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['dependencies'], true);
  assert.deepEqual(enabled.changed, ['dependencies']);
  assert.equal(readConfig(root).dependencyPolicy.enabled, true);
});

test('enables Stylelint together with the style complexity gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['styleComplexity'], true);
  assert.deepEqual(enabled.changed, ['stylelint', 'styleComplexity']);
  const config = readConfig(root);
  assert.equal(config.preCommit.stylelint.enabled, true);
  assert.equal(config.preCommit.stylelint.complexity.enabled, true);
});

test('enables Stylelint together with the style governance gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['styleGovernance'], true);
  assert.deepEqual(enabled.changed, ['stylelint', 'styleGovernance']);
  const config = readConfig(root);
  assert.equal(config.preCommit.stylelint.enabled, true);
  assert.equal(config.preCommit.stylelint.governance.enabled, true);
});

test('disables style enhancements together with Stylelint', (context) => {
  const root = createFixture(sparseConfig({
    preCommit: {
      stylelint: {
        enabled: true,
        complexity: { enabled: true },
        governance: { enabled: true },
      },
    },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const disabled = setFeaturesEnabled(root, ['stylelint'], false);
  assert.deepEqual(disabled.changed, ['styleComplexity', 'styleGovernance', 'stylelint']);
  const config = readConfig(root);
  assert.equal(config.preCommit.stylelint.enabled, false);
  assert.equal(config.preCommit.stylelint.complexity.enabled, false);
  assert.equal(config.preCommit.stylelint.governance.enabled, false);
});

test('enables structured coverage configuration', (context) => {
  const root = createFixture(sparseConfig({
    unitTest: { coverage: { enabled: false } },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['coverage'], true);
  const coverage = readConfig(root).unitTest.coverage;
  assert.deepEqual(enabled.changed, ['unitTest', 'coverage']);
  assert.equal(readConfig(root).unitTest.enabled, true);
  assert.equal(coverage.enabled, true);
  assert.equal(coverage.thresholds.changedLines, 90);
});

test('enables the maximum file lines pre-commit feature', (context) => {
  const root = createFixture(sparseConfig({
    preCommit: { maxFileLines: { enabled: false } },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['maxFileLines'], true);
  assert.deepEqual(enabled.changed, ['maxFileLines']);
  assert.equal(readConfig(root).preCommit.maxFileLines.enabled, true);
});

test('disables and re-enables the default file placement gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const disabled = setFeaturesEnabled(root, ['filePlacement'], false);
  assert.deepEqual(disabled.changed, ['filePlacement']);
  assert.equal(readConfig(root).preCommit.filePlacement.enabled, false);

  const enabled = setFeaturesEnabled(root, ['filePlacement'], true);
  assert.deepEqual(enabled.changed, ['filePlacement']);
  assert.equal(readConfig(root).preCommit.filePlacement.enabled, true);
});

test('enables and disables a configured code placement gate', (context) => {
  const root = createFixture(sparseConfig({
    codePlacement: {
      enabled: false,
      rules: [{
        name: '支付签名',
        content: 'createPaymentSignature(payload)',
        allowedFiles: ['src/payment/signature.ts'],
        scanPatterns: ['src/**/*.ts'],
      }],
    },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['codePlacement'], true);
  assert.deepEqual(enabled.changed, ['codePlacement']);
  assert.equal(readConfig(root).codePlacement.enabled, true);

  const disabled = setFeaturesEnabled(root, ['codePlacement'], false);
  assert.deepEqual(disabled.changed, ['codePlacement']);
  assert.equal(readConfig(root).codePlacement.enabled, false);
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

  assert.throws(() => migrateProjectConfig(root), /非负整数/);
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});

test('migration and feature toggles cannot proceed while a structured exception is expired', (context) => {
  const root = createFixture(sparseConfig({
    exceptions: {
      warningDays: 14,
      maxDays: 90,
      entries: [{
        id: 'expired-exception',
        rule: 'security/no-unsafe-html',
        path: 'src/Legacy.vue',
        line: 1,
        column: 1,
        reason: 'Legacy exception that must be reviewed.',
        owner: 'frontend-team',
        approvedBy: 'security-team',
        ticket: 'SEC-1000',
        createdOn: '2020-01-01',
        expiresOn: '2020-01-31',
      }],
    },
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(
    () => migrateProjectConfig(root),
    /已过期的例外/,
  );
  assert.throws(
    () => setFeaturesEnabled(root, ['notification'], false),
    /已过期的例外/,
  );
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});
