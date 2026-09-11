import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { createChangeSet } from '../../src/core/capability/gate-context.js';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';
import { runCiCommand } from '../../src/orchestration/ci/command.js';
import { runDisable, runEnable } from '../../src/orchestration/cli/configuration.js';
import { runDoctor } from '../../src/orchestration/doctor/runner.js';
import { runInit } from '../../src/orchestration/setup/project-initialization.js';
import { createWorkspaceTargets, workspaceAgentPolicyTargets, workspaceStepTargets } from '../../src/orchestration/workspace/targets.js';
import { renderAgentPolicyDocument } from '../../src/policies/agent-policies.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

const GLOBAL_GATE = 'repository.global-file-placement';
const AGENT_GATE = 'repository.agent-policy';
const RULE_NAME = '全仓 SQL 集中存放';
const APPLICATION_FILE = 'guard.project.json';

function fixture(t, { relativeRoot = '.', mode = 'enforce' } = {}) {
  const lines = [];
  t.mock.method(console, 'log', (...messages) => lines.push(messages.join(' ')));
  t.mock.method(console, 'error', (...messages) => lines.push(messages.join(' ')));
  const configFile = path.posix.join(relativeRoot, APPLICATION_FILE);
  const root = createGitProjectFixture(t, {
    'repo-guard.config.json': JSON.stringify({
      version: 2,
      projects: [{ id: 'api', root: relativeRoot, config: APPLICATION_FILE }],
      repository: { filePlacement: { enabled: true, rules: [{
        name: RULE_NAME, patterns: ['**/*.sql'], allowedPatterns: ['database/sql/**'],
        suggestedDirectory: 'database/sql',
      }] } },
      reporting: { notification: { enabled: false }, commitAnimation: { enabled: false } },
      ci: { enabled: true, gatePolicy: { defaultMode: 'off', gates: { [GLOBAL_GATE]: { mode: 'enforce' } } } },
    }),
    [configFile]: JSON.stringify({
      version: 2,
      project: { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' },
      repository: { rules: [{ pattern: 'team-policy.txt', category: '应用自己的保护规则', level: 'block' }] },
      checks: { javaPathNaming: { enabled: true } },
      ci: { gatePolicy: { defaultMode: 'off', gates: { [AGENT_GATE]: { mode } } } },
    }),
    'database/sql/schema.sql': 'select 1;\n',
    'README.md': '验收样例\n',
  });
  fixtureGit(root, ['config', '--unset', 'core.hooksPath']);
  return { root, configFile, lines };
}

function read(root, file = 'AGENTS.md') {
  return readFileSync(path.join(root, file), 'utf8');
}

function removeOnlyRepositoryPolicy(root) {
  const application = loadWorkspace(root).projects[0];
  writeProjectFile(root, 'AGENTS.md', renderAgentPolicyDocument(read(root), application.config));
  assert.ok(!read(root).includes(RULE_NAME));
  assert.match(read(root), /Java\/Maven|javaPathNaming/);
}

test('同根初始化和诊断修复包含公共提交规则，启停不污染 Java 应用配置', async (t) => {
  const { root, configFile, lines } = fixture(t);
  const document = JSON.parse(read(root, 'repo-guard.config.json'));
  document.repository.commitMessage = { enabled: true, types: ['fix'], requireScope: true, allowedScopes: ['api'] };
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(document));
  const original = read(root, configFile);
  assert.equal(runInit(root), EXIT_CODES.success);
  assert.match(read(root), /提交信息必须符合 Conventional Commit.*fix/);
  assert.match(read(root), /scope 为必填项/);
  assert.equal(await runDoctor(root), EXIT_CODES.success, lines.join('\n'));
  removeOnlyRepositoryPolicy(root);
  assert.doesNotMatch(read(root), /提交信息必须符合 Conventional Commit/);
  assert.equal(await runDoctor(root), EXIT_CODES.error);
  assert.equal(await runDoctor(root, { fix: true }), EXIT_CODES.success, lines.join('\n'));
  assert.match(read(root), /提交信息必须符合 Conventional Commit/);
  assert.equal(runDisable(['commitMessage'], root, { projectId: 'api' }), EXIT_CODES.success);
  assert.doesNotMatch(read(root), /提交信息必须符合 Conventional Commit/);
  assert.equal(runEnable(['commitMessage'], root, { projectId: 'api' }), EXIT_CODES.success);
  assert.match(read(root), /提交信息必须符合 Conventional Commit/);
  assert.match(read(root), /checks\.javaPathNaming/);
  assert.equal(read(root, configFile), original);
  assert.equal(loadWorkspace(root).projects[0].config.repository.commitMessage.enabled, false);
});

test('同根规范同时包含仓库交付和应用规则，分目录时公共规范仍留在根目录', (t) => {
  for (const relativeRoot of ['.', 'services/api']) {
    const { root } = fixture(t, { relativeRoot });
    const document = JSON.parse(read(root, 'repo-guard.config.json'));
    document.repository.deliveryContract = { enabled: true };
    writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(document));
    const workspace = loadWorkspace(root);
    const application = workspace.projects[0];
    const before = JSON.stringify(application.config);
    const targets = workspaceAgentPolicyTargets(workspace);
    const shared = targets.find((target) => target.root === workspace.root);
    assert.match(renderAgentPolicyDocument('', shared.config), /人工确认功能归属/);
    const app = targets.find((target) => target.root === application.root);
    const rendered = renderAgentPolicyDocument('', app.config);
    assert.equal(rendered.includes('人工确认功能归属'), relativeRoot === '.');
    assert.match(rendered, /checks\.javaPathNaming/);
    assert.equal(JSON.stringify(application.config), before);
    assert.equal(application.config.repository.deliveryContract.enabled, false);
  }
});

test('同根应用的初始化、诊断修复和启停均保留公共归位及应用规范，原应用配置不变', async (t) => {
  const { root, configFile, lines } = fixture(t);
  const originalApplication = read(root, configFile);
  assert.equal(runInit(root), EXIT_CODES.success);
  assert.ok(read(root).includes(RULE_NAME));
  assert.match(read(root), /Java\/Maven 工程检查|javaPathNaming/);
  assert.match(read(root), /checks\.javaPathNaming/);
  assert.equal(await runDoctor(root), EXIT_CODES.success, lines.join('\n'));

  removeOnlyRepositoryPolicy(root);
  assert.equal(await runDoctor(root), EXIT_CODES.error);
  assert.equal(await runDoctor(root, { fix: true }), EXIT_CODES.success, lines.join('\n'));
  assert.ok(read(root).includes(RULE_NAME));
  assert.equal(runDisable(['repositoryFilePlacement'], root, { projectId: 'api' }), EXIT_CODES.success);
  assert.ok(!read(root).includes(RULE_NAME));
  assert.match(read(root), /checks\.javaPathNaming/);
  assert.equal(runEnable(['repositoryFilePlacement'], root, { projectId: 'api' }), EXIT_CODES.success);
  assert.ok(read(root).includes(RULE_NAME));
  assert.equal(await runDoctor(root), EXIT_CODES.success, lines.join('\n'));
  assert.equal(read(root, configFile), originalApplication);
});

test('同根仅托管规范上下文合成公共规则，应用门禁与不同目录应用仍使用原配置', (t) => {
  for (const relativeRoot of ['.', 'services/api']) {
    const { root } = fixture(t, { relativeRoot });
    const workspace = loadWorkspace(root);
    const application = workspace.projects[0];
    const before = JSON.stringify(application.config);
    const targets = createWorkspaceTargets({
      workspace, environment: 'ci-policy', changes: createChangeSet({ source: '验收', changes: [] }),
    });
    const policyTargets = workspaceAgentPolicyTargets(workspace);
    const applicationPolicy = policyTargets.find(({ root: targetRoot }) => targetRoot === application.root);
    assert.equal(applicationPolicy.config.repository.filePlacement.enabled, relativeRoot === '.');
    assert.deepEqual(applicationPolicy.config.repository.rules, application.config.repository.rules);
    assert.equal(workspaceStepTargets(targets, { gateId: AGENT_GATE }).find(({ root: targetRoot }) => targetRoot === application.root)
      .config.repository.filePlacement.enabled, relativeRoot === '.');
    assert.equal(workspaceStepTargets(targets, { gateId: 'java.path-naming' })[0].config, application.config);
    assert.equal(application.config.repository.filePlacement.enabled, false);
    assert.equal(JSON.stringify(application.config), before);
    assert.equal(workspaceStepTargets(targets, { gateId: GLOBAL_GATE }).length, 1);
    assert.equal(workspaceStepTargets(targets, { gateId: GLOBAL_GATE })[0].config, workspace.repositoryConfig);
  }
});

for (const mode of ['enforce', 'report']) {
  test(`同根 CI 只验证一份完整规范，缺少公共规则按 ${mode} 策略处理且不重复执行归位`, async (t) => {
    const { root, lines } = fixture(t, { mode });
    assert.equal(runInit(root), EXIT_CODES.success);
    const head = fixtureGit(root, ['rev-parse', 'HEAD']);
    const options = { profile: 'policy', base: head, head, projectId: 'api', env: {} };
    assert.equal(await runCiCommand(root, options), EXIT_CODES.success, lines.join('\n'));
    const reports = () => ({
      repository: JSON.parse(read(root, 'reports/repo-guard-workspace/repository.json')),
      application: JSON.parse(read(root, 'reports/repo-guard-workspace/projects/api.json')),
    });
    const initial = reports();
    assert.equal(initial.repository.steps.some(({ gateResult }) => gateResult?.gateId === AGENT_GATE), false);
    assert.equal(initial.repository.steps.filter(({ gateResult }) => gateResult?.gateId === GLOBAL_GATE).length, 1);
    assert.equal(initial.application.steps.some(({ gateResult }) => gateResult?.gateId === GLOBAL_GATE), false);
    assert.equal(initial.application.steps.filter(({ gateResult }) => gateResult?.gateId === AGENT_GATE).length, 1);
    assert.equal(initial.application.steps.find(({ gateResult }) => gateResult?.gateId === AGENT_GATE).gateResult.status, 'passed');

    removeOnlyRepositoryPolicy(root);
    assert.equal(await runCiCommand(root, options), mode === 'enforce' ? EXIT_CODES.violation : EXIT_CODES.success, lines.join('\n'));
    const failed = reports();
    assert.equal(failed.application.steps.find(({ gateResult }) => gateResult?.gateId === AGENT_GATE).gateResult.status, 'violation');
    assert.equal(failed.repository.steps.find(({ gateResult }) => gateResult?.gateId === GLOBAL_GATE).gateResult.status, 'passed');
    assert.equal(loadWorkspace(root).projects[0].config.repository.filePlacement.enabled, false);
  });
}

test('CI 没有受影响应用时仍按同根唯一规范核验一次，完整规范不误报且缺失公共规则可阻断', async (t) => {
  const { root, lines } = fixture(t);
  const document = JSON.parse(read(root, 'repo-guard.config.json'));
  document.ci.gatePolicy.gates[AGENT_GATE] = { mode: 'enforce' };
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(document));
  assert.equal(runInit(root), EXIT_CODES.success);
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  const options = { profile: 'policy', base: head, head, env: {} };
  assert.equal(await runCiCommand(root, options), EXIT_CODES.success, lines.join('\n'));
  const initial = JSON.parse(read(root, 'reports/repo-guard.json'));
  assert.deepEqual(initial.selectedProjects, []);
  assert.equal(initial.targets.length, 1);
  const steps = initial.targets[0].report.steps;
  assert.equal(steps.filter(({ gateResult }) => gateResult?.gateId === AGENT_GATE).length, 1);
  assert.equal(steps.find(({ gateResult }) => gateResult?.gateId === AGENT_GATE).gateResult.status, 'passed');
  assert.equal(steps.filter(({ gateResult }) => gateResult?.gateId === GLOBAL_GATE).length, 1);

  removeOnlyRepositoryPolicy(root);
  assert.equal(await runCiCommand(root, options), EXIT_CODES.violation, lines.join('\n'));
  const failed = JSON.parse(read(root, 'reports/repo-guard-workspace/repository.json'));
  assert.equal(failed.steps.find(({ gateResult }) => gateResult?.gateId === AGENT_GATE).gateResult.status, 'violation');
  assert.equal(loadWorkspace(root).projects[0].config.repository.filePlacement.enabled, false);
});
