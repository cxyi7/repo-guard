import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_UNIT_TEST_CONFIG } from '../../../src/config/defaults.js';
import { createChangeSet } from '../../../src/core/capability/gate-context.js';
import { collectRevisionChanges } from '../../../src/git/change-collection.js';
import { inspectUnitTestPolicy } from '../../../src/gates/testing/unit-test-policy.js';
import { inspectCoverageReports } from '../../../src/integrations/vitest/coverage.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../../helpers/git-project.js';

const EFFECTIVE_TEST = "it('验证结果', () => { expect(1).toBe(1); });\n";

function testingConfig(extra = {}) {
  return {
    ...DEFAULT_UNIT_TEST_CONFIG,
    requireTests: 'changedFiles',
    sourcePatterns: ['src/**/*.{js,ts,vue}'],
    testPatterns: ['**/*.spec.ts'],
    exclusions: [],
    mappings: [{ sourcePattern: 'src/**/*.{js,ts,vue}', testTemplates: ['{dir}/{name}.spec.ts'] }],
    componentInteraction: { enabled: false, componentPatterns: ['src/**/*.vue'] },
    ...extra,
  };
}

function writeCoverage(root, sourcePaths) {
  const metric = { total: 3, covered: 3, pct: 100 };
  writeProjectFile(root, 'coverage/coverage-summary.json', JSON.stringify({
    total: Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map((name) => [name, metric])),
  }));
  writeProjectFile(root, 'coverage/lcov.info', sourcePaths.map(({ file, hits }) => [
    `SF:${file}`, ...hits.map((hit, index) => `DA:${index + 1},${hit}`), 'end_of_record', '',
  ].join('\n')).join('\n'));
}

test('后端单元测试策略读取所选提交中的应用测试，不使用其他应用或未提交修改', (t) => {
  const root = createGitProjectFixture(t, {
    'src/service.spec.ts': '',
    'apps/web/src/service.spec.ts': '',
    'apps/api/src/service.ts': 'export const ready = true;\n',
    'apps/api/src/service.spec.ts': EFFECTIVE_TEST,
  });
  const api = path.join(root, 'apps/api');
  const headSha = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeProjectFile(api, 'src/service.spec.ts', "it.skip('未提交修改', () => {});\n");
  const result = inspectUnitTestPolicy({
    root: api,
    changes: createChangeSet({ source: 'revision', changes: [{ status: 'M', path: 'src/service.ts', oldPath: null, headSha }] }),
    config: testingConfig(),
  });
  assert.deepEqual(result.missingTests, []);
  assert.deepEqual(result.bypasses, []);
});

test('只修改前端测试时仍从应用提交树中定位关联组件', (t) => {
  const root = createGitProjectFixture(t, {
    'apps/web/src/Editor.vue': '<template><button @click="save">保存</button></template>\n',
    'apps/web/src/Editor.spec.ts': EFFECTIVE_TEST,
    'apps/other/src/Editor.vue': '<template><p>静态内容</p></template>\n',
  });
  const headSha = fixtureGit(root, ['rev-parse', 'HEAD']);
  const result = inspectUnitTestPolicy({
    root: path.join(root, 'apps/web'),
    changes: createChangeSet({ source: 'revision', changes: [{ status: 'M', path: 'src/Editor.spec.ts', oldPath: null, headSha }] }),
    config: testingConfig({ componentInteraction: { enabled: true, componentPatterns: ['src/**/*.vue'] } }),
  });
  assert.equal(result.componentInteractions.length, 1);
  assert.equal(result.componentInteractions[0].sourcePath, 'src/Editor.vue');
});

test('增量覆盖率只计算指定应用和提交范围，不混入其他应用同名源码', (t) => {
  const original = 'export const first = 1;\nexport const second = 2;\nexport const third = 3;\n';
  const root = createGitProjectFixture(t, {
    'src/shared.js': original,
    'apps/web/src/shared.js': original,
    'apps/api/src/shared.js': original,
  });
  const web = path.join(root, 'apps/web');
  const api = path.join(root, 'apps/api');
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeProjectFile(api, 'src/shared.js', original.replace('second = 2', 'second = 20'));
  writeProjectFile(web, 'src/shared.js', original.replace('third = 3', 'third = 30'));
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 分别修改前后端']);
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeProjectFile(api, 'src/shared.js', original.replace('first = 1', 'first = 100'));
  writeCoverage(api, [
    { file: path.join(api, 'src/shared.js'), hits: [0, 1, 0] },
    { file: path.join(web, 'src/shared.js'), hits: [0, 0, 0] },
  ]);
  const report = inspectCoverageReports({
    root: api,
    config: testingConfig({ coverage: { enabled: true, reportsDirectory: 'coverage' } }),
    changes: collectRevisionChanges(api, base, head),
  });
  assert.equal(report.changed.eligibleFiles, 1);
  assert.equal(report.changed.total, 1);
  assert.equal(report.changed.covered, 1);
  assert.deepEqual(report.changed.uncovered, []);
});

test('跨应用移入源码按新增文件完整计算覆盖率', (t) => {
  const root = createGitProjectFixture(t, {
    'apps/web/src/moving.js': 'export const first = 1;\nexport const second = 2;\n',
    'apps/api/package.json': '{"name":"api"}',
  });
  const api = path.join(root, 'apps/api');
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeProjectFile(api, 'src/placeholder.js', '');
  fixtureGit(root, ['mv', 'apps/web/src/moving.js', 'apps/api/src/moving.js']);
  fixtureGit(root, ['commit', '-m', 'test: 移入后端源码']);
  writeCoverage(api, [{ file: 'src/moving.js', hits: [1, 0] }]);
  const report = inspectCoverageReports({
    root: api,
    config: testingConfig({ coverage: { enabled: true, reportsDirectory: 'coverage' } }),
    changes: collectRevisionChanges(api, base, 'HEAD'),
  });
  assert.equal(report.changed.total, 2);
  assert.equal(report.changed.covered, 1);
  assert.deepEqual(report.changed.uncovered, ['src/moving.js:2']);
});
