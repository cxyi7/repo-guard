import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCiCommand } from '../../src/orchestration/ci/command.js';
import { aggregateWorkspaceGateResults } from '../../src/orchestration/ci/workspace-runner.js';
import { createProjectReleaseReadyPlan } from '../../src/orchestration/execution-plans.js';
import { normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { createProjectGateRegistry } from '../../src/gates/registry.js';
import { createGateResult } from '../../src/core/result/gate-result.js';
import { configurationError } from '../../src/core/error/repo-guard-error.js';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { syncAgentPolicies } from '../../src/policies/agent-policies.js';

const descriptor = { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' };
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function json(file, value) { writeFileSync(file, JSON.stringify(value, null, 2)); }
function fixture(t, { otherId = 'worker' } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-ci-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.email', 'engineering@example.invalid');
  git(root, 'config', 'user.name', '工程检查');
  writeFileSync(path.join(root, '.gitignore'), '**/reports/\n');
  for (const id of ['api', otherId]) {
    const app = path.join(root, id);
    mkdirSync(path.join(app, 'src'), { recursive: true });
    json(path.join(app, 'package.json'), { name: id, version: '1.0.0' });
    json(path.join(app, 'repo-guard.config.json'), {
      version: 2,
      project: id === 'web'
        ? { id, role: 'frontend', stack: 'node', preset: 'vue-javascript' }
        : { ...descriptor, id },
      checks: { eslint: { enabled: false }, prettier: { enabled: false } },
    });
    writeFileSync(path.join(app, 'src', 'service.js'), 'export const ready = true;\n');
  }
  json(path.join(root, 'repo-guard.config.json'), {
    version: 2,
    projects: [{ id: 'api', root: 'api' }, { id: otherId, root: otherId }],
    repository: { dependencyPolicy: { enabled: false } },
    reporting: { notification: { enabled: false } },
    ci: { enabled: true, profile: 'full', gatePolicy: { gates: { 'repository.agent-policy': { mode: 'off' } } } },
  });
  git(root, 'add', '.');
  git(root, '-c', 'core.hooksPath=', 'commit', '-m', 'chore: 初始化测试仓库');
  const base = git(root, 'rev-parse', 'HEAD');
  writeFileSync(path.join(root, 'api', 'src', 'service.js'), 'export const ready = false;\n');
  git(root, 'add', '.');
  git(root, '-c', 'core.hooksPath=', 'commit', '-m', 'fix: 调整通用实现');
  return { root, base, head: git(root, 'rev-parse', 'HEAD') };
}
function report(root) { return JSON.parse(readFileSync(path.join(root, 'reports/repo-guard.json'), 'utf8')); }

function enableAndSynchronizeAgentPolicies(root) {
  const file = path.join(root, 'repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.ci.gatePolicy = { defaultMode: 'inherit', gates: {} };
  json(file, document);
  const workspace = loadWorkspace(root);
  const rootApplication = workspace.projects.find((application) => application.root === root);
  syncAgentPolicies(root, rootApplication?.config ?? workspace.repositoryConfig);
  for (const application of workspace.projects.filter((project) => project.root !== root)) {
    syncAgentPolicies(application.root, application.config);
  }
}

function tamperAgentPolicy(root) {
  const file = path.join(root, 'AGENTS.md');
  const original = readFileSync(file, 'utf8');
  const changed = original.replace(/(<!-- repo-guard:[^\n]+:start -->)/, '$1\n这条受管规范已被错误修改。');
  assert.notEqual(changed, original);
  writeFileSync(file, changed);
}

function agentPolicyStep(target) {
  return target.report.steps.find((step) => step.name === 'repository.agent-policy');
}

test('CI 分别核验前后端 AGENTS，单选 web 不检查 api，公共规范仍阻断', async (t) => {
  const repo = fixture(t, { otherId: 'web' });
  enableAndSynchronizeAgentPolicies(repo.root);
  tamperAgentPolicy(path.join(repo.root, 'api'));
  const options = { base: repo.base, head: repo.head, profile: 'policy', env: {} };
  assert.notEqual(await runCiCommand(repo.root, options), 0);
  const all = report(repo.root);
  assert.equal(agentPolicyStep(all.targets.find((target) => target.projectId === 'api')).gateResult.status, 'violation');
  assert.equal(agentPolicyStep(all.targets.find((target) => target.projectId === 'web')).gateResult.status, 'passed');
  assert.equal(agentPolicyStep(all.targets.find((target) => target.scope === 'repository')).gateResult.status, 'passed');
  assert.equal(all.targets.filter((target) => target.scope === 'repository' && agentPolicyStep(target)).length, 1);

  assert.equal(await runCiCommand(repo.root, { ...options, projectId: 'web' }), 0);
  const webOnly = report(repo.root);
  assert.deepEqual(webOnly.selectedProjects, ['web']);
  assert.equal(webOnly.targets.some((target) => target.projectId === 'api'), false);
  assert.equal(webOnly.targets.filter((target) => agentPolicyStep(target)).length, 2);

  tamperAgentPolicy(repo.root);
  assert.notEqual(await runCiCommand(repo.root, { ...options, projectId: 'web' }), 0);
  const failed = report(repo.root);
  assert.equal(agentPolicyStep(failed.targets.find((target) => target.scope === 'repository')).gateResult.status, 'violation');
  assert.equal(agentPolicyStep(failed.targets.find((target) => target.projectId === 'web')).gateResult.status, 'passed');
});

test('清单声明 root 为点时，AGENTS 只按该应用配置核验一次', async (t) => {
  const repo = fixture(t);
  const file = path.join(repo.root, 'repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.projects = [{ id: 'repository', root: '.', config: 'custom.json' }];
  json(file, document);
  json(path.join(repo.root, 'package.json'), { name: 'root-application', version: '1.0.0' });
  json(path.join(repo.root, 'custom.json'), {
    version: 2, project: { ...descriptor, id: 'repository' },
    checks: { eslint: { enabled: false }, prettier: { enabled: false } },
  });
  enableAndSynchronizeAgentPolicies(repo.root);
  const options = { base: repo.base, head: repo.head, profile: 'policy', env: {} };
  assert.equal(await runCiCommand(repo.root, options), 0);
  const result = report(repo.root);
  assert.equal(agentPolicyStep(result.targets.find((target) => target.scope === 'repository')), undefined);
  assert.equal(agentPolicyStep(result.targets.find((target) => target.scope === 'project')).gateResult.status, 'passed');
  assert.equal(result.targets.filter((target) => agentPolicyStep(target)).length, 1);
  tamperAgentPolicy(repo.root);
  assert.notEqual(await runCiCommand(repo.root, options), 0);
  assert.equal(agentPolicyStep(report(repo.root).targets.find((target) => target.scope === 'project')).gateResult.status, 'violation');
});

test('多应用 CI 各目录独立检查、公共规则只执行一次且报告不覆盖', async (t) => {
  const repo = fixture(t);
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
  const result = report(repo.root);
  assert.equal(result.version, 2);
  assert.equal(result.targets.length, 3);
  assert.deepEqual(result.selectedProjects, ['api', 'worker']);
  assert.equal(result.targets.filter((target) => target.report.steps.some((step) => step.name === 'repository.commit-message')).length, 1);
  assert.equal(result.targets[0].report.steps.some((step) => step.name === 'dependencies.policy'), false);
  assert.equal(result.targets[1].report.steps.some((step) => step.name === 'dependencies.policy'), true);
  assert.equal(new Set(result.targets.map((target) => target.reportPath)).size, 3);
  assert.equal(result.targets[1].report.projectRoot, 'api');
});

test('清单声明仓库根应用时，应用标识也不能与公共报告命名冲突', async (t) => {
  const repo = fixture(t);
  const configPath = path.join(repo.root, 'repo-guard.config.json');
  const current = JSON.parse(readFileSync(configPath, 'utf8'));
  current.projects = [{ id: 'repository', root: '.', config: 'root-project.json' }];
  json(configPath, current);
  json(path.join(repo.root, 'root-project.json'), {
    version: 2, project: { ...descriptor, id: 'repository' },
    checks: { eslint: { enabled: false }, prettier: { enabled: false } },
  });
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
  const targets = report(repo.root).targets;
  assert.equal(new Set(targets.map(({ reportPath }) => reportPath)).size, 2);
  assert.equal(JSON.parse(readFileSync(path.join(repo.root, targets[0].reportPath), 'utf8')).scope, 'repository');
  assert.equal(JSON.parse(readFileSync(path.join(repo.root, targets[1].reportPath), 'utf8')).scope, 'project');
});

test('明确选择应用时仅运行该应用，其他应用失败不伪装为已检查', async (t) => {
  const repo = fixture(t);
  writeFileSync(path.join(repo.root, 'worker', 'src', 'service.js'), 'eval("unknown()");\n');
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {}, projectId: 'api' }), 0);
  assert.deepEqual(report(repo.root).selectedProjects, ['api']);
  assert.equal(report(repo.root).targets.length, 2);
  assert.notEqual(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
  assert.equal(report(repo.root).status, 'failed');
  assert.equal(report(repo.root).targets.find((target) => target.projectId === 'worker').exitCode, 2);
});

test('v2 发布就绪执行通用工程检查且最后复核证据，不要求 npm 包发布脚本', async (t) => {
  const repo = fixture(t);
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {}, profile: 'release-ready' }), 0);
  const result = report(repo.root);
  assert.equal(result.targets.at(-1).scope, 'evidence');
  assert.equal(result.targets.at(-1).report.steps[0].name, 'release.delivery-evidence');
  assert.equal(result.targets.flatMap((target) => target.report.steps).some((step) => ['release.check', 'release.test', 'release.package'].includes(step.name)), false);
  const config = normalizeProjectDocument({ version: 2, project: descriptor });
  const plan = createProjectReleaseReadyPlan(config, createProjectGateRegistry(config));
  assert.ok(plan.steps.some((step) => step.gateId === 'quality.eslint'));
  assert.ok(plan.steps.some((step) => step.gateId === 'quality.typecheck'));
  assert.ok(plan.steps.some((step) => step.gateId === 'quality.unit-test'));
});

test('多应用同名门禁汇总不允许后一个成功覆盖前一个失败', () => {
  const failed = createGateResult({ gateId: 'quality.build', status: 'violation', summary: '构建未通过' });
  const passed = createGateResult({ gateId: 'quality.build', status: 'passed', summary: '构建通过' });
  const results = aggregateWorkspaceGateResults([
    { projectId: 'api', report: { steps: [{ gateResult: failed }] } },
    { projectId: 'worker', report: { steps: [{ gateResult: passed }] } },
  ]);
  assert.equal(results[0].status, 'violation');
  assert.equal(results[0].metrics.targets, 2);
  assert.match(results[0].diagnostics[0].message, /api/);
  assert.match(results[0].diagnostics[1].message, /worker/);
  const sameApplication = aggregateWorkspaceGateResults([
    { projectId: 'api', report: { steps: [{ gateResult: failed }, { gateResult: passed }] } },
  ]);
  assert.equal(sameApplication[0].status, 'violation');
});

test('工具配置错误保持错误类型，Git 范围错误不会被误报为通过', async (t) => {
  const configFailure = createGateResult({
    gateId: 'quality.build', status: 'configuration-error', summary: '缺少构建配置',
    error: configurationError('build/missing-script', '缺少构建脚本'),
  });
  const passed = createGateResult({ gateId: 'quality.build', status: 'passed', summary: '构建通过' });
  const aggregated = aggregateWorkspaceGateResults([
    { projectId: 'api', report: { steps: [{ gateResult: configFailure }] } },
    { projectId: 'worker', report: { steps: [{ gateResult: passed }] } },
  ]);
  assert.equal(aggregated[0].status, 'configuration-error');
  assert.equal(aggregated[0].error.kind, 'configuration');
  const repo = fixture(t);
  assert.equal(await runCiCommand(repo.root, { base: 'missing-revision', head: repo.head, env: {} }), 3);
  assert.equal(report(repo.root).status, 'range-error');
});

test('CI 禁用时单应用和多应用都返回非零，错误保留在聚合结果中', async (t) => {
  const repo = fixture(t);
  const configPath = path.join(repo.root, 'repo-guard.config.json');
  const current = JSON.parse(readFileSync(configPath, 'utf8'));
  current.ci.enabled = false;
  json(configPath, current);
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 1);
  assert.ok(report(repo.root).targets.every(({ exitCode }) => exitCode === 1));
  assert.equal(report(repo.root).gateResults[0].status, 'configuration-error');
  assert.equal(report(repo.root).gateResults[0].error.code, 'ci/disabled');
  json(configPath, { version: 2, project: descriptor, ci: { enabled: false } });
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 1);
  assert.equal(report(repo.root).gateResult.error.code, 'ci/disabled');
});

test('自定义汇总路径和内部报告不能覆盖外部结果，错误报告也必须避让', async (t) => {
  const repo = fixture(t);
  const configPath = path.join(repo.root, 'repo-guard.config.json');
  const current = JSON.parse(readFileSync(configPath, 'utf8'));
  const external = {
    id: 'project.engineering', enabled: false, environments: ['ci-full'],
    script: 'test:engineering', timeoutMs: 1000,
    report: { format: 'repo-guard-json-v1', path: 'reports/external.json' },
  };
  mkdirSync(path.join(repo.root, 'reports'), { recursive: true });
  const original = '独立工具的原始结果';
  writeFileSync(path.join(repo.root, external.report.path), original);
  current.ci.externalGates = [external];
  json(configPath, current);
  const options = { base: repo.base, head: repo.head, env: {}, reportPath: external.report.path };
  assert.equal(await runCiCommand(repo.root, options), 1);
  assert.equal(readFileSync(path.join(repo.root, external.report.path), 'utf8'), original);
  assert.equal(report(repo.root).gateResult.error.code, 'ci/report-path-collision');

  external.report.path = 'reports/repo-guard-workspace/repository.json';
  mkdirSync(path.dirname(path.join(repo.root, external.report.path)), { recursive: true });
  writeFileSync(path.join(repo.root, external.report.path), original);
  json(configPath, current);
  assert.equal(await runCiCommand(repo.root, { ...options, reportPath: undefined }), 1);
  assert.equal(readFileSync(path.join(repo.root, external.report.path), 'utf8'), original);

  external.report.path = 'reports/external.json';
  json(configPath, { version: 2, project: descriptor, ci: { enabled: true, externalGates: [external] } });
  assert.equal(await runCiCommand(repo.root, options), 1);
  assert.equal(readFileSync(path.join(repo.root, external.report.path), 'utf8'), original);
});
