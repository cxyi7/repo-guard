import {
  parseProjectFixture,
  stringifyProjectFixture,
} from '../helpers/project-config.js';
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
  setFeaturesEnabled,
} from '../../src/orchestration/setup/config-management.js';
import { CONFIG_FILE } from '../../src/config/validation-primitives.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function createFixture(config) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'config-management-'));
  writeFileSync(
    path.join(root, CONFIG_FILE),
    `${stringifyProjectFixture(config, null, 2)}\n`,
  );
  return root;
}

function readConfig(root) {
  return parseProjectFixture(
    readFileSync(path.join(root, CONFIG_FILE), 'utf8'),
  );
}

function sparseConfig(extra = {}) {
  return {
    version: 2,
    project: {
      id: 'web',
      role: 'frontend',
      stack: 'node',
      preset: 'vue-javascript',
    },
    repository: {
      rules: [
        {
          pattern: 'src/**',
          category: 'Source',
          level: 'audit',
        },
      ],
    },
    ...extra,
  };
}

test('starter configuration enables standard gates and leaves Stylelint opt-in', () => {
  const config = createStarterConfig();

  assert.equal(config.checks.eslint.enabled, true);
  assert.equal(config.checks.eslint.preset, true);
  assert.equal(config.checks.eslint.fix, true);
  assert.equal(config.checks.prettier.enabled, true);
  assert.equal(config.checks.prettier.fix, true);
  assert.equal(config.checks.stylelint.enabled, false);
  assert.equal(config.checks.styleComplexity.enabled, false);
  assert.equal(config.checks.styleGovernance.enabled, false);
  assert.equal(config.checks.asyncResourceCleanup.enabled, false);
  assert.equal(config.checks.pathNaming.enabled, false);
  assert.equal(config.checks.pathNaming.convention, 'camelCase');
  assert.equal(config.checks.fileHeader.enabled, false);
  assert.equal(config.checks.functionDocs.enabled, false);
  assert.equal(config.checks.filePlacement.enabled, true);
  assert.equal(config.checks.filePlacement.mode, 'newFiles');
  assert.equal(config.checks.filePlacement.rules.length, 2);
  assert.equal(config.repository.codePlacement.enabled, false);
  assert.deepEqual(config.repository.codePlacement.rules, []);
  assert.equal(config.checks.maxFileLines.enabled, true);
  assert.equal(config.checks.maxFileLines.mode, 'strict');
  assert.equal(config.checks.maxFileLines.warnAt, 0.85);
  assert.deepEqual(config.checks.maxFileLines.rules, [
    { pattern: '**/*.vue', maxLines: 700 },
    { pattern: '**/*.{js,mjs,cjs,jsx}', maxLines: 1000 },
    { pattern: '**/*.{ts,tsx}', maxLines: 1000 },
  ]);
  assert.equal(config.checks.lighthouse.enabled, false);
  assert.equal(config.repository.dependencyPolicy.enabled, true);
  assert.equal(config.repository.commitMessage.enabled, false);
  assert.equal(config.checks.deadCode.enabled, false);
  assert.equal(config.checks.deadCode.mode, 'strict');
  assert.equal(
    config.checks.deadCode.baselineFile,
    '.repo-guard/knip-baseline.json',
  );
  assert.equal(config.checks.imageAssets.enabled, false);
  assert.equal(config.checks.imageAssets.naming.convention, 'camelCase');
  assert.equal(config.checks.uiTokens.enabled, false);
  assert.deepEqual(config.checks.uiTokens.languages, ['css']);
  assert.equal(Object.hasOwn(config.checks.uiTokens, 'adapters'), false);
  assert.equal(config.checks.architecture.enabled, false);
  assert.equal(config.checks.accessibilityTest.enabled, false);
  assert.equal(config.checks.architecture.rules.length, 3);
  assert.equal(config.checks.build.enabled, false);
  assert.equal(config.checks.build.artifactBudget.enabled, false);
  assert.equal(
    config.repository.rules.some(
      ({ pattern }) => pattern === '.repo-guard/build-artifact-baseline.json',
    ),
    true,
  );
  assert.equal(config.checks.typeCheck.enabled, false);
  assert.equal(config.checks.unitTest.enabled, false);
  assert.equal(config.checks.unitTest.requireTests, 'newFiles');
  assert.equal(config.checks.componentInteraction.enabled, false);
  assert.equal(config.checks.unitTest.mappings.length, 5);
  assert.equal(config.checks.mutationTest.enabled, false);
  assert.equal(config.checks.mutationTest.reportsDirectory, 'reports/mutation');
  assert.deepEqual(config.checks.mutationTest.guardedBuilds, []);
  assert.equal(config.reporting.notification.enabled, true);
  assert.equal(config.ci.enabled, false);
  assert.equal(config.ci.profile, 'policy');
  assert.equal(config.ci.reportPath, 'reports/repo-guard.json');
  assert.deepEqual(config.ci.gatePolicy, { defaultMode: 'inherit', gates: {} });
  assert.equal(Object.hasOwn(config.ci, 'pipeline'), false);
  assert.deepEqual(config.ci.externalGates, []);
  assert.deepEqual(config.repository.exceptions, {
    warningDays: 14,
    maxDays: 90,
    entries: [],
  });
  assert.equal(config.repository.dependencyPolicy.enabled, true);
  assert.equal(config.repository.dependencyPolicy.requireExactVersions, true);
  assert.deepEqual(config.repository.dependencyPolicy.allowedProtocols, [
    'npm',
    'workspace',
  ]);
  assert.equal(config.repository.rules.length, 12);
  assert.equal(
    config.repository.rules.every(({ level }) => level === 'notify'),
    true,
  );
  assert.equal(
    config.repository.rules.some(
      ({ pattern }) => pattern === '.repo-guard/knip-baseline.json',
    ),
    true,
  );
});

test('starter configuration enables Stylelint when project setup was detected', () => {
  const config = createStarterConfig({
    stylelintEnabled: true,
  });

  assert.equal(config.checks.stylelint.enabled, true);
  assert.equal(config.checks.styleComplexity.enabled, true);
  assert.equal(config.checks.styleGovernance.enabled, true);
});

test('can enable and disable image asset governance independently', (context) => {
  const root = createFixture(createStarterConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['imageAssets'], true);
  assert.deepEqual(enabled.changed, ['imageAssets']);
  assert.equal(readConfig(root).checks.imageAssets.enabled, true);

  const disabled = setFeaturesEnabled(root, ['imageAssets'], false);
  assert.deepEqual(disabled.changed, ['imageAssets']);
  assert.equal(readConfig(root).checks.imageAssets.enabled, false);
});

test('enabling unused image assets also enables its parent and disabling the parent closes both', (context) => {
  const root = createFixture(createStarterConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['unusedImageAssets'], true);
  assert.deepEqual(enabled.changed, ['imageAssets', 'unusedImageAssets']);
  assert.equal(readConfig(root).checks.imageAssets.enabled, true);
  assert.equal(readConfig(root).checks.unusedImageAssets.enabled, true);

  const disabled = setFeaturesEnabled(root, ['imageAssets'], false);
  assert.deepEqual(disabled.changed, ['unusedImageAssets', 'imageAssets']);
  assert.equal(readConfig(root).checks.imageAssets.enabled, false);
  assert.equal(readConfig(root).checks.unusedImageAssets.enabled, false);
});

test('starter configuration enables build when its project script was detected', () => {
  const config = createStarterConfig({
    buildEnabled: true,
  });

  assert.equal(config.checks.build.enabled, true);
  assert.equal(config.checks.build.script, 'build');
});

test('starter configuration enables architecture when dependency-cruiser was detected', () => {
  const config = createStarterConfig({
    architectureEnabled: true,
  });

  assert.equal(config.checks.architecture.enabled, true);
  assert.deepEqual(config.checks.architecture.sourcePaths, ['src']);
});

test('starter configuration enables unit tests when project setup was detected', () => {
  const config = createStarterConfig({
    unitTestEnabled: true,
  });

  assert.equal(config.checks.unitTest.enabled, true);
  assert.equal(config.checks.componentInteraction.enabled, false);
  assert.equal(config.checks.unitTest.script, 'test:unit');
});

test('starter configuration enables axe accessibility tests when setup was detected', () => {
  const config = createStarterConfig({
    accessibilityTestEnabled: true,
  });

  assert.equal(config.checks.accessibilityTest.enabled, true);
  assert.equal(config.checks.accessibilityTest.script, 'test:a11y');
  assert.equal(config.checks.accessibilityTest.testPatterns.length, 2);
});

test('starter configuration enables TypeScript when its project script was detected', () => {
  const config = createStarterConfig({
    typeCheckEnabled: true,
  });

  assert.equal(config.checks.typeCheck.enabled, true);
  assert.equal(config.checks.typeCheck.script, 'typecheck');
});

test('enables selected quality gates and preserves explicit settings', (context) => {
  const root = createFixture(
    sparseConfig({
      checks: {
        eslint: {
          enabled: false,
        },
        prettier: {
          enabled: false,
          requireConfig: false,
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = enableQualityGates(root, [
    'eslint',
    'prettier',
    'stylelint',
    'eslint',
  ]);
  const config = readConfig(root);

  assert.deepEqual(result.enabled, ['eslint', 'prettier', 'stylelint']);
  assert.equal(config.checks.eslint.enabled, true);
  assert.equal(config.checks.prettier.enabled, true);
  assert.equal(config.checks.prettier.requireConfig, false);
  assert.equal(config.checks.stylelint.enabled, true);
});

test('rejects unsupported gates without rewriting configuration', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(() => enableQualityGates(root, ['biome']), /不支持的质量门禁/);
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});

test('disables and re-enables project notification', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const disabled = setFeaturesEnabled(root, ['notification'], false);
  assert.deepEqual(disabled.changed, ['notification']);
  assert.equal(readConfig(root).reporting.notification.enabled, false);

  const enabled = setFeaturesEnabled(root, ['notification'], true);
  assert.deepEqual(enabled.changed, ['notification']);
  assert.equal(readConfig(root).reporting.notification.enabled, true);
});

test('enables the Vue Lighthouse pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['lighthouse'], true);
  assert.deepEqual(enabled.changed, ['lighthouse']);
  assert.equal(readConfig(root).checks.lighthouse.enabled, true);
});

test('enables the unit test pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['unitTest'], true);
  assert.deepEqual(enabled.changed, ['unitTest']);
  assert.equal(readConfig(root).checks.unitTest.enabled, true);
});

test('enables component interaction with unit tests and disables both consistently', (context) => {
  const root = createFixture(
    sparseConfig({
      checks: {
        unitTest: {
          enabled: false,
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['componentInteraction'], true);
  assert.deepEqual(enabled.changed, ['unitTest', 'componentInteraction']);
  let config = readConfig(root);
  assert.equal(config.checks.unitTest.enabled, true);
  assert.equal(config.checks.componentInteraction.enabled, true);

  const disabled = setFeaturesEnabled(root, ['unitTest'], false);
  assert.deepEqual(disabled.changed, ['componentInteraction', 'unitTest']);
  config = readConfig(root);
  assert.equal(config.checks.unitTest.enabled, false);
  assert.equal(config.checks.componentInteraction.enabled, false);
});

test('enables the axe accessibility test pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['accessibilityTest'], true);
  assert.deepEqual(enabled.changed, ['accessibilityTest']);
  assert.equal(readConfig(root).checks.accessibilityTest.enabled, true);
});

test('enables the architecture pre-push feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['architecture'], true);
  assert.deepEqual(enabled.changed, ['architecture']);
  assert.equal(readConfig(root).checks.architecture.enabled, true);
});

test('enables and disables the dead-code project gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['deadCode'], true);
  assert.deepEqual(enabled.changed, ['deadCode']);
  assert.equal(readConfig(root).checks.deadCode.enabled, true);
  const disabled = setFeaturesEnabled(root, ['deadCode'], false);
  assert.deepEqual(disabled.changed, ['deadCode']);
  assert.equal(readConfig(root).checks.deadCode.enabled, false);
});

test('在项目声明样式语言后启用和禁用 UI Token 门禁', (context) => {
  const root = createFixture(
    sparseConfig({
      checks: {
        uiTokens: {
          enabled: false,
          languages: ['css', 'sass', 'less'],
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['uiTokens'], true);
  assert.deepEqual(enabled.changed, ['uiTokens']);
  assert.equal(readConfig(root).checks.uiTokens.enabled, true);
  assert.deepEqual(readConfig(root).checks.uiTokens.languages, ['css', 'sass', 'less']);
  assert.equal(
    readConfig(root).repository.rules.some(
      ({ pattern, category }) =>
        pattern === 'ui-tokens.manifest.json' && category === 'UI Token 契约',
    ),
    true,
  );

  const disabled = setFeaturesEnabled(root, ['uiTokens'], false);
  assert.deepEqual(disabled.changed, ['uiTokens']);
  assert.equal(readConfig(root).checks.uiTokens.enabled, false);
});

test('enables the dependency governance pre-commit feature', (context) => {
  const root = createFixture(
    sparseConfig({
      repository: {
        dependencyPolicy: {
          enabled: false,
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['dependencies'], true);
  assert.deepEqual(enabled.changed, ['dependencies']);
  assert.equal(readConfig(root).repository.dependencyPolicy.enabled, true);
});

test('enables and disables the commit message lifecycle gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['commitMessage'], true);
  assert.deepEqual(enabled.changed, ['commitMessage']);
  assert.equal(readConfig(root).repository.commitMessage.enabled, true);

  const disabled = setFeaturesEnabled(root, ['commitMessage'], false);
  assert.deepEqual(disabled.changed, ['commitMessage']);
  assert.equal(readConfig(root).repository.commitMessage.enabled, false);
});

test('enables Stylelint together with the style complexity gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['styleComplexity'], true);
  assert.deepEqual(enabled.changed, ['stylelint', 'styleComplexity']);
  const config = readConfig(root);
  assert.equal(config.checks.stylelint.enabled, true);
  assert.equal(config.checks.styleComplexity.enabled, true);
});

test('enables Stylelint together with the style governance gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['styleGovernance'], true);
  assert.deepEqual(enabled.changed, ['stylelint', 'styleGovernance']);
  const config = readConfig(root);
  assert.equal(config.checks.stylelint.enabled, true);
  assert.equal(config.checks.styleGovernance.enabled, true);
});

test('disables style enhancements together with Stylelint', (context) => {
  const root = createFixture(
    sparseConfig({
      checks: {
        stylelint: {
          enabled: true,
        },
        styleComplexity: {
          enabled: true,
        },
        styleGovernance: {
          enabled: true,
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const disabled = setFeaturesEnabled(root, ['stylelint'], false);
  assert.deepEqual(disabled.changed, [
    'styleComplexity',
    'styleGovernance',
    'stylelint',
  ]);
  const config = readConfig(root);
  assert.equal(config.checks.stylelint.enabled, false);
  assert.equal(config.checks.styleComplexity.enabled, false);
  assert.equal(config.checks.styleGovernance.enabled, false);
});

test('enables structured coverage configuration', (context) => {
  const root = createFixture(
    sparseConfig({
      checks: {
        unitTest: {},
        coverage: {
          enabled: false,
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['coverage'], true);
  const coverage = readConfig(root).checks.coverage;
  assert.deepEqual(enabled.changed, ['unitTest', 'coverage']);
  assert.equal(readConfig(root).checks.unitTest.enabled, true);
  assert.equal(coverage.enabled, true);
  assert.equal(coverage.thresholds.changedLines, 90);
});

test('enables the maximum file lines pre-commit feature', (context) => {
  const root = createFixture(
    sparseConfig({
      checks: {
        maxFileLines: {
          enabled: false,
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['maxFileLines'], true);
  assert.deepEqual(enabled.changed, ['maxFileLines']);
  assert.equal(readConfig(root).checks.maxFileLines.enabled, true);
});

test('enables and disables contract-driven delivery as one feature', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['deliveryContract'], true);
  assert.deepEqual(enabled.changed, ['deliveryContract']);
  assert.equal(readConfig(root).repository.deliveryContract.enabled, true);

  const disabled = setFeaturesEnabled(root, ['deliveryContract'], false);
  assert.deepEqual(disabled.changed, ['deliveryContract']);
  assert.equal(readConfig(root).repository.deliveryContract.enabled, false);
});

test('disables and re-enables the default file placement gate', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const disabled = setFeaturesEnabled(root, ['filePlacement'], false);
  assert.deepEqual(disabled.changed, ['filePlacement']);
  assert.equal(readConfig(root).checks.filePlacement.enabled, false);

  const enabled = setFeaturesEnabled(root, ['filePlacement'], true);
  assert.deepEqual(enabled.changed, ['filePlacement']);
  assert.equal(readConfig(root).checks.filePlacement.enabled, true);
});

test('启用和禁用文件头同步功能', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['fileHeader'], true);
  assert.deepEqual(enabled.changed, ['fileHeader']);
  assert.equal(readConfig(root).checks.fileHeader.enabled, true);

  const disabled = setFeaturesEnabled(root, ['fileHeader'], false);
  assert.deepEqual(disabled.changed, ['fileHeader']);
  assert.equal(readConfig(root).checks.fileHeader.enabled, false);
});

test('启用和禁用函数文档同步功能', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['functionDocs'], true);
  assert.deepEqual(enabled.changed, ['functionDocs']);
  assert.equal(readConfig(root).checks.functionDocs.enabled, true);

  const disabled = setFeaturesEnabled(root, ['functionDocs'], false);
  assert.deepEqual(disabled.changed, ['functionDocs']);
  assert.equal(readConfig(root).checks.functionDocs.enabled, false);
});

test('启用和禁用异步资源清理门禁', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['asyncResourceCleanup'], true);
  assert.deepEqual(enabled.changed, ['asyncResourceCleanup']);
  assert.equal(readConfig(root).checks.asyncResourceCleanup.enabled, true);

  const disabled = setFeaturesEnabled(root, ['asyncResourceCleanup'], false);
  assert.deepEqual(disabled.changed, ['asyncResourceCleanup']);
  assert.equal(readConfig(root).checks.asyncResourceCleanup.enabled, false);
});

test('启用和禁用统一路径命名门禁', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['pathNaming'], true);
  assert.deepEqual(enabled.changed, ['pathNaming']);
  assert.equal(readConfig(root).checks.pathNaming.enabled, true);

  const disabled = setFeaturesEnabled(root, ['pathNaming'], false);
  assert.deepEqual(disabled.changed, ['pathNaming']);
  assert.equal(readConfig(root).checks.pathNaming.enabled, false);
});

test('enables and disables a configured code placement gate', (context) => {
  const root = createFixture(
    sparseConfig({
      repository: {
        codePlacement: {
          enabled: false,
          rules: [
            {
              name: '支付签名',
              content: 'createPaymentSignature(payload)',
              allowedFiles: ['src/payment/signature.ts'],
              scanPatterns: ['src/**/*.ts'],
            },
          ],
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const enabled = setFeaturesEnabled(root, ['codePlacement'], true);
  assert.deepEqual(enabled.changed, ['codePlacement']);
  assert.equal(readConfig(root).repository.codePlacement.enabled, true);

  const disabled = setFeaturesEnabled(root, ['codePlacement'], false);
  assert.deepEqual(disabled.changed, ['codePlacement']);
  assert.equal(readConfig(root).repository.codePlacement.enabled, false);
});

test('拒绝无效 v2 配置且不改写原文件', (context) => {
  const root = createFixture(sparseConfig());
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(sparseConfig({
    checks: { eslint: { maxWarnings: -1 } },
  })));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(() => setFeaturesEnabled(root, ['eslint'], true), /非负整数/);
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});

test('结构化例外过期时禁止功能启停且不改写原文件', (context) => {
  const root = createFixture(
    sparseConfig({
      repository: {
        exceptions: {
          warningDays: 14,
          maxDays: 90,
          entries: [
            {
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
            },
          ],
        },
      },
    }),
  );
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readFileSync(path.join(root, CONFIG_FILE), 'utf8');

  assert.throws(
    () => setFeaturesEnabled(root, ['notification'], false),
    /已过期的例外/,
  );
  assert.equal(readFileSync(path.join(root, CONFIG_FILE), 'utf8'), before);
});
