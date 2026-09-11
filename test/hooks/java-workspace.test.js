import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadStagedWorkspace } from '../../src/orchestration/workspace/configuration-snapshot.js';
import { runWorkspaceQualityExecution } from '../../src/orchestration/pre-commit/quality-runner.js';
import { runRegisteredManualGate } from '../../src/orchestration/cli/manual-gates.js';
import { runCiCommand } from '../../src/orchestration/ci/command.js';
import { EXIT_CODES, gateResultToExitCode } from '../../src/core/result/exit-code.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

function javaProject(id, checks) {
  return JSON.stringify({
    version: 2,
    project: { id, role: 'backend', stack: 'java', preset: 'java-maven' },
    checks,
    ci: { gatePolicy: { defaultMode: 'off', gates: { 'java.files': { mode: 'enforce' } } } },
  });
}

function fixture(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  return createGitProjectFixture(t, {
    'repo-guard.config.json': JSON.stringify({
      version: 2,
      projects: [{ id: 'api', root: 'apps/api' }, { id: 'worker', root: 'services/worker' }],
      ci: { enabled: true, gatePolicy: { defaultMode: 'off' } },
      reporting: { notification: { enabled: false } },
    }),
    'apps/api/repo-guard.config.json': javaProject('api', { javaFiles: { enabled: true } }),
    'services/worker/repo-guard.config.json': javaProject('worker', {
      javaFormat: { enabled: true, command: 'definitely-unavailable-java-tool' },
    }),
    'apps/api/src/main/java/sample/Good.java': 'package sample;\npublic class Good {}\n',
    'services/worker/src/main/java/sample/Worker.java': 'package sample;\npublic class Worker {}\n',
  });
}

test('Java 暂存违规在手动、Hook 和 CI 返回同一违规码，且不加载其他应用工具', async (t) => {
  const root = fixture(t);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  const relative = 'apps/api/target/Leaked.class';
  writeProjectFile(root, relative, Buffer.from('cafebabe', 'hex'));
  fixtureGit(root, ['add', relative]);
  const staged = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, relative)]);
  assert.equal(staged.exitCode, EXIT_CODES.violation);
  assert.equal(staged.decisiveResult.gateId, 'java.files');
  assert.equal(staged.decisiveResult.findings[0].location.path, 'target/Leaked.class');
  const manual = await runRegisteredManualGate('java-files', [], root, { projectId: 'api' });
  assert.equal(gateResultToExitCode(manual), EXIT_CODES.violation);
  fixtureGit(root, ['commit', '-m', 'test: 验证产物不能进入仓库']);
  const ci = await runCiCommand(root, { base, head: fixtureGit(root, ['rev-parse', 'HEAD']), profile: 'full', env: {} });
  assert.equal(ci, EXIT_CODES.violation);
});

test('Java 配置变更会复核既有跟踪文件，删除违规文件后不再阻断', async (t) => {
  const root = fixture(t);
  const relative = 'apps/api/target/Leaked.class';
  writeProjectFile(root, relative, Buffer.from('cafebabe', 'hex'));
  fixtureGit(root, ['add', relative]);
  fixtureGit(root, ['commit', '-m', 'test: 构造已有产物']);
  const configPath = 'apps/api/repo-guard.config.json';
  writeProjectFile(root, configPath, `${javaProject('api', { javaFiles: { enabled: true } })}\n`);
  fixtureGit(root, ['add', configPath]);
  const changed = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, configPath)]);
  assert.equal(changed.exitCode, EXIT_CODES.violation);
  fixtureGit(root, ['rm', relative]);
  const deleted = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, configPath)]);
  assert.equal(deleted.exitCode, EXIT_CODES.success);
});

test('Java 应用仅暂存文档时不加载无匹配源码的格式工具', async (t) => {
  const root = fixture(t);
  const relative = 'services/worker/README.md';
  writeProjectFile(root, relative, '# 工作进程说明\n');
  fixtureGit(root, ['add', relative]);
  const execution = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, relative)]);
  assert.equal(execution.exitCode, EXIT_CODES.success);
  assert.equal(execution.results.find(({ gateId }) => gateId === 'java.format').status, 'skipped');
});
