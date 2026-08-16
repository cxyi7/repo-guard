import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defineGate } from '../src/core/capability/gate-definition.js';
import { createGateRegistry } from '../src/core/capability/gate-registry.js';
import { gateRegistry } from '../src/gates/registry.js';
import { dynamicCodeGate } from '../src/gates/security/dynamic-code-gate.js';

function gate(overrides = {}) {
  return defineGate({
    id: 'example.gate',
    environments: ['manual'],
    mutation: 'read-only',
    defaultTimeoutMs: 1000,
    inspectSetup: () => ({ status: 'ready' }),
    plan: () => ({}),
    run: () => null,
    ...overrides,
  });
}

const POLICY_ENVIRONMENTS = Object.freeze([
  'manual',
  'pre-commit',
  'ci-policy',
  'ci-full',
  'release-ready',
]);
const CI_POLICY_ENVIRONMENTS = Object.freeze([
  'pre-commit',
  'ci-policy',
  'ci-full',
  'release-ready',
]);

function reviewedGateDescriptor(id, environments, overrides = {}) {
  return {
    id,
    resultModel: 'GateResult',
    configKey: null,
    featureName: null,
    featureOrder: null,
    configVersions: [1],
    environments,
    mutation: 'read-only',
    allowedMutations: ['read-only'],
    defaultTimeoutMs: 120000,
    requires: [],
    before: [],
    after: [],
    conflicts: [],
    manualCommand: null,
    manualOptions: [],
    manualOrder: null,
    doctorOrder: null,
    packageScript: null,
    rules: [],
    requiredTools: [],
    requiredScripts: [],
    requiredEnvironment: [],
    requiredSecrets: [],
    artifactTypes: [],
    supportsFix: false,
    supportsCancellation: false,
    ...overrides,
  };
}

const REVIEWED_OFFICIAL_GATE_DESCRIPTORS = Object.freeze([
  reviewedGateDescriptor('security.dynamic-code', POLICY_ENVIRONMENTS, {
    manualCommand: 'dynamic-code',
    manualOrder: 70,
    doctorOrder: 70,
    packageScript: 'guard:dynamic-code',
    rules: ['security/no-eval', 'security/no-function-constructor'],
  }),
  reviewedGateDescriptor('security.vue-unsafe-html', POLICY_ENVIRONMENTS, {
    manualCommand: 'unsafe-html',
    manualOrder: 80,
    doctorOrder: 80,
    packageScript: 'guard:unsafe-html',
    rules: ['vue/no-v-html'],
  }),
  reviewedGateDescriptor('security.vue-target-blank', POLICY_ENVIRONMENTS, {
    manualCommand: 'target-blank',
    manualOrder: 90,
    doctorOrder: 90,
    packageScript: 'guard:target-blank',
    rules: ['vue/target-blank-security'],
  }),
  reviewedGateDescriptor('accessibility.vue-form-label', POLICY_ENVIRONMENTS, {
    manualCommand: 'form-labels',
    manualOrder: 100,
    doctorOrder: 100,
    packageScript: 'guard:form-labels',
    rules: ['vue/form-control-label'],
  }),
  reviewedGateDescriptor('accessibility.vue-image-alt', POLICY_ENVIRONMENTS, {
    manualCommand: 'image-alt',
    manualOrder: 110,
    doctorOrder: 110,
    packageScript: 'guard:image-alt',
    rules: ['vue/img-alt'],
  }),
  reviewedGateDescriptor(
    'repository.structured-exceptions',
    ['manual', 'ci-policy', 'ci-full', 'release-ready'],
    {
      configKey: 'exceptions',
      defaultTimeoutMs: 30000,
      manualCommand: 'exceptions',
      manualOrder: 10,
      packageScript: 'guard:exceptions',
    },
  ),
  reviewedGateDescriptor('dependencies.policy', POLICY_ENVIRONMENTS, {
    configKey: 'dependencyPolicy',
    featureName: 'dependencies',
    featureOrder: 80,
    manualCommand: 'dependencies',
    manualOrder: 20,
    doctorOrder: 120,
    packageScript: 'guard:dependencies',
  }),
  reviewedGateDescriptor('repository.file-placement', POLICY_ENVIRONMENTS, {
    configKey: 'preCommit.filePlacement',
    featureName: 'filePlacement',
    featureOrder: 40,
    manualCommand: 'file-placement',
    manualOrder: 150,
    doctorOrder: 150,
    packageScript: 'guard:file-placement',
  }),
  reviewedGateDescriptor('repository.code-placement', POLICY_ENVIRONMENTS, {
    configKey: 'codePlacement',
    featureName: 'codePlacement',
    featureOrder: 45,
    manualCommand: 'code-placement',
    manualOrder: 155,
    doctorOrder: 155,
    packageScript: 'guard:code-placement',
  }),
  reviewedGateDescriptor('repository.maximum-file-lines', CI_POLICY_ENVIRONMENTS, {
    configKey: 'preCommit.maxFileLines',
    featureName: 'maxFileLines',
    featureOrder: 50,
    doctorOrder: 140,
  }),
  reviewedGateDescriptor('repository.protected-files', CI_POLICY_ENVIRONMENTS, {
    mutation: 'external-write',
    allowedMutations: ['external-write', 'read-only'],
  }),
  reviewedGateDescriptor('release.check', ['release-ready'], {
    defaultTimeoutMs: 300000,
    requiredScripts: ['check'],
    supportsCancellation: true,
  }),
  reviewedGateDescriptor('release.test', ['release-ready'], {
    defaultTimeoutMs: 900000,
    requiredScripts: ['test'],
    supportsCancellation: true,
  }),
  reviewedGateDescriptor('release.package', ['release-ready'], {
    defaultTimeoutMs: 300000,
    requires: ['release.check', 'release.test'],
    after: ['quality.build'],
    artifactTypes: ['npm-package-manifest'],
    supportsCancellation: true,
  }),
  reviewedGateDescriptor('quality.stylelint', ['pre-commit', 'ci-full'], {
    configKey: 'preCommit.stylelint',
    featureName: 'stylelint',
    featureOrder: 30,
    mutation: 'working-tree-fix',
    allowedMutations: ['working-tree-fix', 'read-only'],
    before: ['quality.eslint'],
    requiredTools: ['stylelint'],
    supportsFix: true,
    doctorOrder: 160,
  }),
  reviewedGateDescriptor('quality.eslint', ['pre-commit', 'ci-full'], {
    configKey: 'preCommit.eslint',
    featureName: 'eslint',
    featureOrder: 10,
    mutation: 'working-tree-fix',
    allowedMutations: ['working-tree-fix', 'read-only'],
    before: ['quality.prettier'],
    requiredTools: ['eslint'],
    supportsFix: true,
    doctorOrder: 130,
  }),
  reviewedGateDescriptor('quality.prettier', ['pre-commit', 'ci-full'], {
    configKey: 'preCommit.prettier',
    featureName: 'prettier',
    featureOrder: 20,
    mutation: 'working-tree-fix',
    allowedMutations: ['working-tree-fix', 'read-only'],
    requiredTools: ['prettier'],
    supportsFix: true,
    doctorOrder: 170,
  }),
  reviewedGateDescriptor('quality.typecheck', ['manual', 'pre-push', 'ci-full'], {
    configKey: 'typeCheck',
    featureName: 'typeCheck',
    featureOrder: 130,
    defaultTimeoutMs: 180000,
    manualCommand: 'typecheck',
    manualOrder: 50,
    doctorOrder: 40,
    packageScript: 'guard:typecheck',
    requiredScripts: ['config:typeCheck.script'],
    supportsCancellation: true,
  }),
  reviewedGateDescriptor(
    'quality.unit-test',
    ['manual', 'pre-push', 'ci-policy', 'ci-full', 'release-ready'],
    {
      configKey: 'unitTest',
      featureName: 'unitTest',
      featureOrder: 140,
      manualCommand: 'unit-test',
      manualOrder: 60,
      doctorOrder: 50,
      packageScript: 'guard:unit-test',
      requiredTools: ['vitest'],
      requiredScripts: ['config:unitTest.script'],
      artifactTypes: ['coverage-report'],
      supportsCancellation: true,
    },
  ),
  reviewedGateDescriptor(
    'quality.accessibility-test',
    ['manual', 'pre-push', 'ci-full', 'release-ready'],
    {
      configKey: 'accessibilityTest',
      featureName: 'accessibilityTest',
      featureOrder: 100,
      defaultTimeoutMs: 180000,
      manualCommand: 'accessibility-test',
      manualOrder: 120,
      doctorOrder: 60,
      packageScript: 'guard:accessibility-test',
      requiredScripts: ['config:accessibilityTest.script'],
      supportsCancellation: true,
    },
  ),
  reviewedGateDescriptor('quality.architecture', ['manual', 'pre-push', 'ci-full'], {
    configKey: 'architecture',
    featureName: 'architecture',
    featureOrder: 90,
    manualCommand: 'architecture',
    manualOrder: 40,
    doctorOrder: 20,
    packageScript: 'guard:architecture',
    requiredTools: ['dependency-cruiser'],
  }),
  reviewedGateDescriptor(
    'quality.build',
    ['manual', 'pre-push', 'ci-full', 'release-ready'],
    {
      configKey: 'build',
      featureName: 'build',
      featureOrder: 110,
      defaultTimeoutMs: 300000,
      manualCommand: 'build',
      manualOrder: 30,
      doctorOrder: 10,
      packageScript: 'guard:build',
      requiredScripts: ['config:build.script'],
      artifactTypes: ['build-output'],
      supportsCancellation: true,
    },
  ),
  reviewedGateDescriptor('quality.lighthouse', ['manual', 'pre-push', 'release-ready'], {
    configKey: 'lighthouse',
    featureName: 'lighthouse',
    featureOrder: 120,
    defaultTimeoutMs: 300000,
    manualCommand: 'lighthouse',
    manualOptions: ['--skip-build'],
    manualOrder: 160,
    doctorOrder: 30,
    packageScript: 'guard:lighthouse',
    requiredTools: ['@lhci/cli'],
    artifactTypes: ['lighthouse-report'],
  }),
  reviewedGateDescriptor('quality.style-complexity', ['manual'], {
    configKey: 'preCommit.stylelint.complexity',
    featureName: 'styleComplexity',
    featureOrder: 60,
    manualCommand: 'style-complexity',
    manualOrder: 130,
    packageScript: 'guard:style-complexity',
    requiredTools: ['stylelint'],
  }),
  reviewedGateDescriptor('quality.style-governance', ['manual'], {
    configKey: 'preCommit.stylelint.governance',
    featureName: 'styleGovernance',
    featureOrder: 70,
    manualCommand: 'style-governance',
    manualOrder: 140,
    packageScript: 'guard:style-governance',
    requiredTools: ['stylelint'],
  }),
]);

function officialGateDescriptor(gateDefinition) {
  const metadataEntries = Object.entries(gateDefinition)
    .filter(([, value]) => typeof value !== 'function');
  assert.deepEqual(
    metadataEntries.map(([field]) => field),
    Object.keys(REVIEWED_OFFICIAL_GATE_DESCRIPTORS[0]),
  );
  return Object.fromEntries(metadataEntries);
}

test('defines immutable gate metadata and exposes the dynamic-code vertical slice', () => {
  const dynamicCode = gateRegistry.get('security.dynamic-code');
  assert.equal(Object.isFrozen(dynamicCode), true);
  assert.equal(dynamicCode.resultModel, 'GateResult');
  assert.equal(dynamicCode.manualCommand, 'dynamic-code');
  assert.equal(dynamicCode.packageScript, 'guard:dynamic-code');
  assert.equal(dynamicCode.mutation, 'read-only');
  assert.deepEqual(dynamicCode.allowedMutations, ['read-only']);
  assert.deepEqual(dynamicCode.environments, [
    'manual',
    'pre-commit',
    'ci-policy',
    'ci-full',
    'release-ready',
  ]);
  assert.deepEqual(dynamicCode.rules, [
    'security/no-eval',
    'security/no-function-constructor',
  ]);
  assert.deepEqual(dynamicCode.requiredTools, []);
  assert.deepEqual(dynamicCode.requiredScripts, []);
  assert.deepEqual(dynamicCode.requiredEnvironment, []);
  assert.deepEqual(dynamicCode.requiredSecrets, []);
  assert.deepEqual(dynamicCode.artifactTypes, []);
  assert.equal(dynamicCode.supportsFix, false);
  assert.equal(dynamicCode.supportsCancellation, false);
  assert.equal('renderConsole' in dynamicCodeGate, false);
  assert.equal('renderConsole' in dynamicCode, false);
  assert.equal(gateRegistry.findByManualCommand('dynamic-code'), dynamicCode);
  assert.deepEqual(dynamicCode.inspectSetup({ config: { version: 1 } }), {
    status: 'ready',
    summary: '动态代码暂存门禁（硬性要求，规则=security/no-eval+security/no-function-constructor）',
    rules: dynamicCode.rules,
  });
});

test('keeps every official Gate capability descriptor on the reviewed contract', () => {
  assert.deepEqual(
    gateRegistry.all.map(officialGateDescriptor),
    REVIEWED_OFFICIAL_GATE_DESCRIPTORS,
  );
});

test('keeps a supplied file scope immutable without letting the gate own console output', () => {
  const sourceFile = { absolute: 'C:/repo/src/example.js', relative: 'src/example.js' };
  const plan = dynamicCodeGate.plan({ root: 'C:/repo', files: [sourceFile] });

  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.files), true);
  assert.equal(Object.isFrozen(plan.files[0]), true);
  assert.notEqual(plan.files[0], sourceFile);
  sourceFile.relative = 'src/changed.js';
  assert.equal(plan.files[0].relative, 'src/example.js');
  assert.throws(
    () => dynamicCodeGate.plan({ root: 'C:/repo' }),
    /要求明确的文件范围/,
  );
  assert.throws(
    () => dynamicCodeGate.run({ root: 'C:/repo', config: { exceptions: [] } }),
    /要求执行计划/,
  );
});

test('enforces the migrated gate dependency boundary', () => {
  const source = readFileSync(
    new URL('../src/gates/security/dynamic-code-gate.js', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /from ['"].*renderer\.js['"]/);
  assert.doesNotMatch(source, /collectProjectFiles|collectStagedChanges|runGit/);
  assert.doesNotMatch(source, /\bconsole\.|process\.exit(?:Code)?/);
});

test('rejects duplicate identities, duplicate commands, and missing dependencies', () => {
  assert.throws(
    () => createGateRegistry([gate(), gate()]),
    /门禁 id 重复/,
  );
  assert.throws(
    () => createGateRegistry([
      gate({ id: 'first', manualCommand: 'example', manualOrder: 1 }),
      gate({ id: 'second', manualCommand: 'example', manualOrder: 2 }),
    ]),
    /门禁手动命令重复/,
  );
  assert.throws(
    () => createGateRegistry([gate({ requires: ['missing.gate'] })]),
    /requires 指向未知门禁/,
  );
  assert.throws(
    () => createGateRegistry([
      gate({ id: 'first', requires: ['second'] }),
      gate({ id: 'second', requires: ['first'] }),
    ]),
    /门禁依赖环/,
  );
});

test('validates gate lifecycle, mutation, timeout, and handlers', () => {
  assert.throws(() => gate({ environments: ['runtime'] }), /包含不支持的值/);
  assert.throws(() => gate({ mutation: 'network' }), /门禁 mutation/);
  assert.throws(
    () => gate({ mutation: 'working-tree-fix', allowedMutations: ['read-only'] }),
    /必须包含其最高变更级别/,
  );
  assert.throws(() => gate({ defaultTimeoutMs: 0 }), /正整数/);
  assert.throws(() => gate({ run: null }), /必须是函数/);
  assert.throws(() => gate({ supportsFix: 'yes' }), /必须是布尔值/);
  assert.throws(
    () => gate({ configKey: 'example', featureName: 'example' }),
    /设置 featureName 时必须同时设置 featureOrder/,
  );
  assert.throws(
    () => gate({ manualCommand: 'example' }),
    /设置 manualCommand 时必须同时设置 manualOrder/,
  );
});

test('records existing tool-backed capability prerequisites and side effects in Registry', () => {
  const eslint = gateRegistry.get('quality.eslint');
  assert.deepEqual(eslint.requiredTools, ['eslint']);
  assert.equal(eslint.supportsFix, true);

  const typecheck = gateRegistry.get('quality.typecheck');
  assert.equal(typecheck.defaultTimeoutMs, 180000);
  assert.equal(typecheck.mutation, 'read-only');
  assert.deepEqual(typecheck.requiredScripts, ['config:typeCheck.script']);

  const unitTest = gateRegistry.get('quality.unit-test');
  assert.deepEqual(unitTest.requiredTools, ['vitest']);
  assert.deepEqual(unitTest.requiredScripts, ['config:unitTest.script']);
  assert.deepEqual(unitTest.artifactTypes, ['coverage-report']);

  const lighthouse = gateRegistry.get('quality.lighthouse');
  assert.equal(lighthouse.defaultTimeoutMs, 300000);
  assert.equal(lighthouse.mutation, 'read-only');
  assert.deepEqual(lighthouse.requiredTools, ['@lhci/cli']);
});

test('keeps staged quality file applicability in each Gate plan', () => {
  const config = {
    preCommit: {
      stylelint: { enabled: true, pattern: '**/*.{css,vue}', fix: true },
      eslint: { enabled: true, pattern: '**/*.{js,vue}', fix: true },
      prettier: { enabled: true, pattern: '**/*.vue', fix: true },
    },
  };
  const context = {
    root: 'C:/project',
    config,
    files: ['src/pages/app.js', 'src/styles/app.css', 'src/components/App.vue', 'test/app.ts'],
    step: { mutation: 'read-only' },
  };

  assert.deepEqual(gateRegistry.get('quality.stylelint').plan(context).files, [
    'src/styles/app.css',
    'src/components/App.vue',
  ]);
  assert.deepEqual(gateRegistry.get('quality.eslint').plan(context).files, [
    'src/pages/app.js',
    'src/components/App.vue',
  ]);
  assert.deepEqual(gateRegistry.get('quality.prettier').plan(context).files, [
    'src/components/App.vue',
  ]);
});
