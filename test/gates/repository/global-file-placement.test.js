import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executionError } from '../../../src/core/error/repo-guard-error.js';
import { EXIT_CODES, gateResultToExitCode } from '../../../src/core/result/exit-code.js';
import { globalFilePlacementGate, runGlobalFilePlacementGate } from '../../../src/gates/repository/global-file-placement-gate.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../../helpers/git-project.js';

const RULE = {
  name: '文档归位', patterns: ['**/*.md'], allowedPatterns: ['docs/**'],
  exceptions: ['README.md'], suggestedDirectory: 'docs',
};
function configuration(overrides = {}) {
  return { repository: { filePlacement: { enabled: true, rules: [RULE], ...overrides } } };
}

test('仓库级门禁元数据独立注册完整生命周期与全量 CI 范围', () => {
  assert.equal(globalFilePlacementGate.id, 'repository.global-file-placement');
  assert.equal(globalFilePlacementGate.configKey, 'repository.filePlacement');
  assert.equal(globalFilePlacementGate.manualCommand, 'repository-file-placement');
  assert.equal(globalFilePlacementGate.featureName, 'repositoryFilePlacement');
  assert.equal(globalFilePlacementGate.defaultTimeoutMs, 30000);
  assert.equal(globalFilePlacementGate.mutation, 'read-only');
  assert.deepEqual(globalFilePlacementGate.ciScopes, ['all-files']);
  assert.deepEqual(globalFilePlacementGate.environments, ['manual', 'pre-commit', 'pre-push', 'ci-policy', 'ci-full', 'release-ready']);
});

test('提交检查覆盖未变动的历史违规和新暂存违规，不受应用目录或候选文件筛选影响', (t) => {
  const root = createGitProjectFixture(t, { 'notes/legacy.md': '历史文档', 'apps/web/main.js': '应用' });
  writeProjectFile(root, 'notes/new.md', '新增文档');
  writeProjectFile(root, 'apps/web/main.js', '应用修改');
  fixtureGit(root, ['add', '--', 'notes/new.md', 'apps/web/main.js']);
  const config = configuration();
  const plan = globalFilePlacementGate.plan({ config, environment: 'pre-commit' });
  const result = globalFilePlacementGate.run({ root: path.join(root, 'apps', 'web'), repositoryRoot: root, config, plan,
    files: ['apps/web/main.js'], changes: { changes: [] }, exceptions: [{ pattern: '**' }] });
  assert.equal(result.status, 'violation');
  assert.equal(gateResultToExitCode(result), EXIT_CODES.violation);
  assert.deepEqual(result.findings.map((finding) => finding.location.path), ['notes/legacy.md', 'notes/new.md']);
  assert.equal(result.metrics.repositoryFiles, 3);
  assert.equal(result.metrics.checkedFiles, 2);
  assert.match(result.summary, /检查依据：完整 Git 暂存区/);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.findings[0].remediation.steps[0], /docs\/legacy.md/);
});

test('暂存删除后不再报告该路径，工作区删除但索引保留时仍阻断', (t) => {
  const root = createGitProjectFixture(t, { 'bad.md': '文档', 'README.md': '说明' });
  rmSync(path.join(root, 'bad.md'));
  const input = { root, config: configuration(), environment: 'pre-commit' };
  assert.equal(globalFilePlacementGate.run(input).status, 'violation');
  fixtureGit(root, ['add', '-u']);
  const result = globalFilePlacementGate.run(input);
  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.repositoryFiles, 1);
});

test('手动工作区包含未跟踪文件而提交树检查只使用指定提交', (t) => {
  const root = createGitProjectFixture(t, { 'bad.md': '旧提交中的文档' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  fixtureGit(root, ['rm', 'bad.md']);
  writeProjectFile(root, 'draft.md', '工作区新文档');
  const config = configuration();
  const manual = globalFilePlacementGate.run({ root, config, environment: 'manual' });
  const ci = globalFilePlacementGate.run({ root, config, environment: 'ci-full', revision: { head } });
  assert.deepEqual(manual.findings.map((finding) => finding.location.path), ['draft.md']);
  assert.deepEqual(ci.findings.map((finding) => finding.location.path), ['bad.md']);
  assert.match(manual.summary, /检查依据：仓库工作区全部受控与未忽略文件/);
  assert.match(ci.summary, /检查依据：指定提交的完整 Git 文件树/);
  assert.match(ci.summary, new RegExp(head));
  assert.deepEqual(ci.diagnostics, []);
});

test('关闭时所有入口均跳过且不读取 Git，CI 执行计划可显式覆盖开关', () => {
  for (const environment of globalFilePlacementGate.environments) {
    const config = configuration({ enabled: false });
    const plan = globalFilePlacementGate.plan({ config, environment });
    assert.equal(plan.enabled, false);
    assert.equal(runGlobalFilePlacementGate({ config, plan, collect: () => assert.fail('关闭时不得读取仓库') }).status, 'skipped');
  }
  const config = configuration({ enabled: false });
  const result = runGlobalFilePlacementGate({ root: process.cwd(), config, plan: { enabled: true, environment: 'ci-policy' },
    collect: () => ({ paths: ['bad.md'], source: 'revision', revision: 'a'.repeat(40), gitlinks: 0 }) });
  assert.equal(result.status, 'violation');
  assert.equal(runGlobalFilePlacementGate({ config: configuration(), plan: { enabled: false } }).status, 'skipped');
});

test('CI 强制开启空规则必须报配置错误，未知配置也不能静默丢弃', () => {
  for (const config of [configuration({ enabled: false, rules: [] }), configuration({ enabled: false, mode: 'newFiles' }), { repository: null }]) {
    const result = runGlobalFilePlacementGate({ config, plan: { enabled: true }, collect: () => assert.fail('无效配置不得读取仓库') });
    assert.equal(result.status, 'configuration-error');
    assert.equal(gateResultToExitCode(result), EXIT_CODES.error);
  }
});

test('完整清单零规则匹配或零文件仍明确通过并报告覆盖数量', () => {
  for (const paths of [[], ['src/main.js']]) {
    const result = runGlobalFilePlacementGate({ config: configuration(), environment: 'manual',
      collect: () => ({ paths, source: 'worktree', revision: null, gitlinks: 2 }) });
    assert.equal(result.status, 'passed');
    assert.equal(result.metrics.repositoryFiles, paths.length);
    assert.equal(result.metrics.checkedFiles, 0);
    assert.equal(result.metrics.excludedGitlinks, 2);
    assert.match(result.summary, /排除 2 个 Git 子模块入口，不进入其内部/);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(gateResultToExitCode(result), EXIT_CODES.success);
  }
});

test('按第一条匹配规则判断，只有规则自身例外可放行', () => {
  const config = configuration({ rules: [RULE, { ...RULE, allowedPatterns: ['**/*.md'] }] });
  const result = runGlobalFilePlacementGate({ config, environment: 'manual',
    collect: () => ({ paths: ['README.md', 'docs/guide.md', 'bad.md'], source: 'worktree', revision: null, gitlinks: 0 }) });
  assert.deepEqual(result.findings.map((finding) => finding.location.path), ['bad.md']);
  assert.equal(result.metrics.checkedFiles, 3);
});

test('Git 读取错误与不可信提交范围保持公共错误分类', (t) => {
  const root = createGitProjectFixture(t, { 'README.md': '说明' });
  const missingRevision = globalFilePlacementGate.run({ root, config: configuration(), environment: 'ci-full' });
  assert.equal(missingRevision.status, 'range-error');
  assert.equal(gateResultToExitCode(missingRevision), EXIT_CODES.range);
  const failed = runGlobalFilePlacementGate({ root, config: configuration(), environment: 'manual',
    collect: () => { throw executionError('git/test-process-failed', '模拟工具启动失败'); } });
  assert.equal(failed.status, 'execution-error');
  assert.equal(gateResultToExitCode(failed), EXIT_CODES.error);
  assert.equal(failed.error.code, 'git/test-process-failed');
  assert.equal(failed.summary, '模拟工具启动失败');
});

test('取消检查不能输出通过，已取消的请求不调用 Git', () => {
  const controller = new AbortController();
  controller.abort();
  const result = runGlobalFilePlacementGate({ config: configuration(), environment: 'manual', signal: controller.signal,
    collect: () => assert.fail('取消后不应读取 Git') });
  assert.equal(result.status, 'execution-error');
  const afterRead = new AbortController();
  const completed = runGlobalFilePlacementGate({ config: configuration(), environment: 'manual', signal: afterRead.signal,
    collect: () => { afterRead.abort(); return { paths: [], source: 'worktree', gitlinks: 0 }; } });
  assert.equal(completed.status, 'execution-error');
});
