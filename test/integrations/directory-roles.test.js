import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { createProjectDocument, serializeProjectConfig } from '../../src/config/project-configuration.js';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { inspectUnitTestPolicy } from '../../src/gates/testing/unit-test-policy.js';
import { buildCoverageArguments } from '../../src/integrations/vitest/coverage.js';
import { createChangeSet } from '../../src/core/capability/gate-context.js';
import { setFeaturesEnabled } from '../../src/orchestration/setup/config-management.js';
import { syncAgentPolicies } from '../../src/policies/agent-policies.js';
import { createGitProjectFixture, writeProjectFile, fixtureGit } from '../helpers/git-project.js';
import { loadStagedWorkspace } from '../../src/orchestration/workspace/configuration-snapshot.js';
import { runUnitTestGate } from '../../src/gates/testing/unit-test-gate.js';

test('真实消费配置改公共方法目录后检出缺失测试，新增对应测试通过，覆盖率使用同一路径', (t) => {
  const document = serializeProjectConfig(createProjectDocument({ id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' }));
  document.directories.entries.utils.path = 'shared/helpers';
  document.directories.entries.utilityTests.path = 'spec/helpers';
  const root = createGitProjectFixture(t, {
    'package.json': '{}', 'repo-guard.config.json': JSON.stringify(document),
    'shared/helpers/round.ts': 'export const round = (value: number) => Math.round(value);',
  });
  const config = loadWorkspace(root).projects[0].config;
  const changes = createChangeSet({ source: 'working-tree', changes: [{ status: 'A', path: 'shared/helpers/round.ts', oldPath: null }] });
  const missing = inspectUnitTestPolicy({ root, config: config.checks.unitTest, changes }).missingTests;
  assert.equal(missing.length, 1);
  assert.equal(missing[0].expectedTestPath, 'spec/helpers/round.test.ts');
  writeProjectFile(root, missing[0].expectedTestPath, "it('边界值', () => { expect(round(0)).toBe(0); });");
  assert.deepEqual(inspectUnitTestPolicy({ root, config: config.checks.unitTest, changes }).missingTests, []);
  assert.ok(buildCoverageArguments({ ...config.checks.unitTest, coverage: config.checks.coverage }).includes('--coverage.include=shared/helpers/**/*.{js,ts}'));
  assert.ok(config.checks.mutationTest.options.mutate[0].startsWith('shared/helpers/'));
  syncAgentPolicies(root, config);
  assert.match(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /shared\/helpers/);
  for (let i = 0; i < 2; i += 1) setFeaturesEnabled(root, ['unitTest', 'coverage', 'mutationTest'], true);
  const after = loadWorkspace(root).projects[0].config;
  assert.deepEqual(after.checks.unitTest.sourcePatterns, config.checks.unitTest.sourcePatterns);
  assert.deepEqual(after.directories, config.directories);
});

test('多应用同名职责独立解析，不继承仓库或相邻应用目录', (t) => {
  const app = (id, root) => ({ version: 2, project: { id, role: 'backend', stack: 'node', preset: 'node-typescript' },
    directories: { entries: { source: { path: root, purpose: '源码' } }, bindings: { 'checks.architecture.sourcePaths': { format: 'path', value: ['${source}'] } } },
  });
  const root = createGitProjectFixture(t, {
    'repo-guard.config.json': JSON.stringify({ version: 2, projects: [{ id: 'a', root: 'apps/a' }, { id: 'b', root: 'apps/b' }] }),
    'apps/a/repo-guard.config.json': JSON.stringify(app('a', 'server')),
    'apps/b/repo-guard.config.json': JSON.stringify(app('b', 'lib')),
  });
  const workspace = loadWorkspace(root);
  assert.deepEqual(workspace.projects.map((item) => item.config.checks.architecture.sourcePaths), [['server'], ['lib']]);
});

test('暂存目录配置与未暂存修改分离，不把工作树的新路径用于提交检查', (t) => {
  const raw = { version: 2, project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' },
    directories: { entries: { source: { path: 'src', purpose: '源码' } }, bindings: { 'checks.architecture.sourcePaths': { format: 'path', value: ['${source}'] } } },
  };
  const root = createGitProjectFixture(t, { 'repo-guard.config.json': JSON.stringify(raw) });
  raw.directories.entries.source.path = 'staged-code';
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(raw));
  fixtureGit(root, ['add', 'repo-guard.config.json']);
  raw.directories.entries.source.path = 'working-code';
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(raw));
  assert.deepEqual(loadStagedWorkspace(root).projects[0].config.checks.architecture.sourcePaths, ['staged-code']);
  assert.deepEqual(loadWorkspace(root).projects[0].config.checks.architecture.sourcePaths, ['working-code']);
});

const vitestPath = path.resolve('test/.tmp/node-audit-tools/node_modules/vitest');
test('目录改名后真实 Vitest 检出错误计算，修复源码后通过', {
  skip: !existsSync(vitestPath) && '需准备审查用 Vitest 4.0.18',
}, async (t) => {
  const raw = serializeProjectConfig(createProjectDocument({ id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' }));
  raw.directories.entries.utils.path = 'shared/helpers';
  raw.directories.entries.utilityTests.path = 'spec/helpers';
  // 本专项只执行单元测试；覆盖率参数联动由前面的专项验证。
  raw.checks.coverage.enabled = false;
  const version = JSON.parse(readFileSync(path.join(vitestPath, 'package.json'), 'utf8')).version;
  const root = createGitProjectFixture(t, {
    'package.json': JSON.stringify({ type: 'module', scripts: { 'test:unit': 'node node_modules/vitest/vitest.mjs run' }, devDependencies: { vitest: version } }),
    'repo-guard.config.json': JSON.stringify(raw),
    'shared/helpers/round.ts': 'export const round = (value: number) => Math.round(value) + 1;',
    'spec/helpers/round.test.ts': 'import {test,expect} from "vitest"; import {round} from "../../shared/helpers/round.ts"; test("零值",()=>expect(round(0)).toBe(0));',
  });
  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  symlinkSync(vitestPath, path.join(root, 'node_modules/vitest'), 'junction');
  const config = loadWorkspace(root).projects[0].config;
  const args = { root, config: { ...config.checks.unitTest, coverage: config.checks.coverage },
    changes: createChangeSet({ source: 'manual', changes: [] }),
  };
  const failed = await runUnitTestGate(args);
  assert.equal(failed.status, 'violation', JSON.stringify(failed));
  writeProjectFile(root, 'shared/helpers/round.ts', 'export const round = (value: number) => Math.round(value);');
  const passed = await runUnitTestGate(args);
  assert.equal(passed.status, 'passed', JSON.stringify(passed));
});
