import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createProjectDocument, normalizeProjectDocument } from '../../../src/config/project-configuration.js';
import { expectedUnitTestPaths, inspectUnitTestPolicy } from '../../../src/gates/testing/unit-test-policy.js';
import { runMutationTestChild } from '../../../src/integrations/stryker/runner-child.js';
import { createChangeSet } from '../../../src/core/capability/gate-context.js';
import { buildCoverageArguments } from '../../../src/integrations/vitest/coverage.js';
import { setFeaturesEnabled } from '../../../src/orchestration/setup/config-management.js';
import { createGitProjectFixture, writeProjectFile } from '../../helpers/git-project.js';

const project = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };

test('公共方法改目录和文件名后采用用户范围，覆盖率与重复启用均不恢复 utils', (t) => {
  const document = createProjectDocument(project);
  Object.assign(document.checks.unitTest, {
    sourcePatterns: ['src/shared/helpers/**/*.ts'],
    testPatterns: ['src/tests/helpers/**/*.test.ts'],
    mappings: [{ sourcePattern: 'src/shared/helpers/**/*.ts', sourceRoot: 'src/shared/helpers',
      testTemplates: ['src/tests/helpers/{relativePath}.test.ts'] }],
  });
  document.checks.mutationTest.options.mutate = ['src/shared/helpers/**/*.ts'];
  const root = createGitProjectFixture(t, {
    'package.json': '{}', 'repo-guard.config.json': JSON.stringify(document),
  });
  const config = normalizeProjectDocument(document).checks.unitTest;
  const changes = createChangeSet({ source: 'working-tree', changes: [
    { status: 'R100', path: 'src/shared/helpers/money/round-price.ts', oldPath: 'src/shared/helpers/money/round.ts' },
    { status: 'A', path: 'src/utils/ignored.ts', oldPath: null },
  ] });
  const missing = inspectUnitTestPolicy({ root, config, changes }).missingTests;
  assert.equal(missing.length, 1);
  assert.equal(missing[0].expectedTestPath, 'src/tests/helpers/money/round-price.test.ts');
  writeProjectFile(root, missing[0].expectedTestPath, "it('验证精度', () => { expect(roundPrice(1.255)).toBe(1.26); });");
  assert.deepEqual(inspectUnitTestPolicy({ root, config, changes }).missingTests, []);
  const args = buildCoverageArguments({ ...config, coverage: document.checks.coverage });
  assert.ok(args.includes('--coverage.include=src/shared/helpers/**/*.ts'));
  assert.equal(args.some((argument) => argument.includes('src/utils')), false);
  for (let repeat = 0; repeat < 2; repeat += 1) setFeaturesEnabled(root, ['unitTest', 'coverage', 'mutationTest'], true);
  const saved = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
  for (const feature of ['unitTest', 'coverage', 'mutationTest']) assert.deepEqual(saved.checks[feature], document.checks[feature]);
});

test('前端默认开启三项公共方法检查，已有开关保留且拒绝已删除配置', () => {
  const { checks } = createProjectDocument(project);
  for (const feature of ['unitTest', 'coverage', 'mutationTest']) assert.equal(checks[feature].enabled, true);
  assert.deepEqual(checks.unitTest.sourcePatterns, ['src/utils/**/*.{js,ts}']);
  assert.equal(checks.mutationTest.options.thresholds.break, 80);
  const existing = normalizeProjectDocument({ version: 2, project, checks: {
    unitTest: { enabled: false }, coverage: { enabled: false }, mutationTest: { enabled: false },
  } });
  for (const feature of ['unitTest', 'coverage', 'mutationTest']) assert.equal(existing.checks[feature].enabled, false);
  for (const removed of ['componentInteraction', 'accessibilityTest']) {
    assert.equal(Object.hasOwn(checks, removed), false);
    assert.throws(() => normalizeProjectDocument({ version: 2, project, checks: { [removed]: { enabled: false } } }));
  }
});

test('嵌套公共方法对应集中测试目录，Vue 组件不要求测试，缺少公共方法测试会阻断', (t) => {
  const root = createGitProjectFixture(t, { 'package.json': '{}' });
  const config = createProjectDocument(project).checks.unitTest;
  assert.deepEqual(expectedUnitTestPaths('src/utils/money/round.ts', config.mappings), [
    'src/tests/utils/money/round.test.ts', 'src/tests/utils/money/round.spec.ts',
  ]);
  const changes = createChangeSet({ source: 'working-tree', changes: [
    { status: 'A', path: 'src/components/editor.vue', oldPath: null },
    { status: 'M', path: 'src/utils/money/round.ts', oldPath: null },
  ] });
  assert.deepEqual(inspectUnitTestPolicy({ root, config, changes }).missingTests.map(({ sourcePath }) => sourcePath), ['src/utils/money/round.ts']);
  writeProjectFile(root, 'src/tests/utils/money/round.test.ts', "it('验证精度', () => { expect(round(1.255)).toBe(1.26); });");
  assert.deepEqual(inspectUnitTestPolicy({ root, config, changes }).missingTests, []);
  assert.throws(() => expectedUnitTestPaths('src/other.ts', [{ sourcePattern: '**/*.ts', sourceRoot: 'src/utils', testTemplates: ['src/tests/{relativePath}.test.ts'] }]));
});

test('Stryker 预设与原生 JSON 和模块合并，原生值优先且报告约束保持生效', async (t) => {
  const root = createGitProjectFixture(t, { 'package.json': '{}' });
  const capture = path.join(root, 'captured.json');
  const entry = path.join(root, 'runner.mjs');
  writeProjectFile(root, 'runner.mjs', `import { writeFileSync } from 'node:fs'; export class Stryker { constructor(options) { this.options = options; } async runMutationTest() { writeFileSync(${JSON.stringify(capture)}, JSON.stringify(this.options)); } }`);
  const defaults = createProjectDocument(project).checks.mutationTest.options;
  defaults.mutate = ['src/shared/helpers/**/*.ts'];
  for (const extension of ['json', 'mjs', 'cjs']) {
    const native = { mutate: ['src/common/round-price.ts'], thresholds: { break: 95 }, inPlace: true, reporters: ['dashboard'] };
    const content = extension === 'json' ? JSON.stringify(native) : `${extension === 'mjs' ? 'export default' : 'module.exports ='} ${JSON.stringify(native)};`;
    writeProjectFile(root, `stryker.config.${extension}`, content);
    await runMutationTestChild([entry, path.join(root, `stryker.config.${extension}`), 'report.json', 'report.html', 'true', JSON.stringify(defaults)]);
    const actual = JSON.parse(readFileSync(capture, 'utf8'));
    assert.deepEqual(actual.mutate, native.mutate);
    assert.equal(actual.thresholds.break, 95);
    assert.equal(actual.thresholds.high, 80);
    assert.equal(actual.inPlace, false);
    assert.equal(actual.reporters.includes('dashboard'), false);
  }
  await runMutationTestChild([entry, path.join(root, 'absent.json'), 'report.json', 'report.html', 'false', JSON.stringify(defaults)]);
  assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')).mutate, defaults.mutate);
});
