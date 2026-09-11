import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createChangeSet } from '../../src/core/capability/gate-context.js';
import { EXIT_CODES, gateResultToExitCode } from '../../src/core/result/exit-code.js';
import { loadStagedWorkspace } from '../../src/orchestration/workspace/configuration-snapshot.js';
import { runWorkspaceQualityExecution } from '../../src/orchestration/pre-commit/quality-runner.js';
import { runRegisteredManualGate } from '../../src/orchestration/cli/manual-gates.js';
import { runCiCommand } from '../../src/orchestration/ci/command.js';
import { protectedFilesGate } from '../../src/gates/repository/repository-policy-gates.js';
import { JAVA_PATH_NAMING_DEFAULTS } from '../../src/config/java-path-naming.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

function fixture(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  return createGitProjectFixture(t, {
    'repo-guard.config.json': JSON.stringify({
      version: 2,
      projects: [{ id: 'api', root: 'apps/api' }, { id: 'web', root: 'apps/web' }],
      ci: { enabled: true, gatePolicy: { defaultMode: 'off' } },
      reporting: { notification: { enabled: false } },
    }),
    'apps/api/repo-guard.config.json': JSON.stringify({
      version: 2,
      project: { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' },
      checks: {
        javaFiles: { enabled: true },
        javaPathNaming: {
          enabled: true,
          rules: [...JAVA_PATH_NAMING_DEFAULTS.javaPathNaming.rules, {
            id: 'controller-suffix', target: 'files',
            include: ['**/controller/*.java'], exclude: [],
            conventions: [], basename: ['*Controller.java'],
          }],
        },
        filePlacement: {
          enabled: true, mode: 'changedFiles',
          rules: [{ name: 'Java 测试文件', patterns: ['**/*Test.java'],
            allowedPatterns: ['src/test/java/**'], exceptions: [], suggestedDirectory: 'src/test/java' }],
        },
      },
      repository: { rules: [{ pattern: 'pom.xml', category: '构建规则', level: 'block' }] },
      ci: { gatePolicy: { defaultMode: 'off', gates: {
        'java.path-naming': { mode: 'enforce' },
        'repository.file-placement': { mode: 'enforce' },
        'repository.protected-files': { mode: 'enforce' },
      } } },
    }),
    'apps/web/repo-guard.config.json': JSON.stringify({
      version: 2,
      project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' },
    }),
    'apps/api/pom.xml': '<project/>\n',
    'apps/api/src/main/java/sample/controller/OrderController.java': 'package sample.controller;\nclass OrderController {}\n',
    'apps/web/src/order-service.ts': 'export const value = 1;\n',
  });
}

test('Java 目录后缀规则在真实暂存、手动和 CI 一致阻断，前端路径不参与', async (t) => {
  const root = fixture(t);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  const relative = 'apps/api/src/main/java/sample/controller/Helper.java';
  writeProjectFile(root, relative, 'package sample.controller;\nclass Helper {}\n');
  fixtureGit(root, ['add', relative]);
  const staged = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, relative)]);
  assert.equal(staged.exitCode, EXIT_CODES.violation);
  assert.equal(staged.decisiveResult.gateId, 'java.path-naming');
  const manual = await runRegisteredManualGate('java-path-naming', [], root, { projectId: 'api' });
  assert.equal(gateResultToExitCode(manual), EXIT_CODES.violation);
  assert.ok(manual.findings.every(({ location }) => !location.path.includes('apps/web')));
  fixtureGit(root, ['commit', '-m', 'test: 验证命名规则']);
  assert.equal(await runCiCommand(root, { base, head: fixtureGit(root, ['rev-parse', 'HEAD']), profile: 'policy', env: {} }), EXIT_CODES.violation);
  const configPath = 'apps/api/repo-guard.config.json';
  writeProjectFile(root, configPath, `${readFileSync(path.join(root, configPath), 'utf8')}\n`);
  fixtureGit(root, ['add', configPath]);
  const configOnly = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, configPath)]);
  assert.equal(configOnly.decisiveResult.gateId, 'java.path-naming');
  assert.equal(configOnly.exitCode, EXIT_CODES.violation);
  fixtureGit(root, ['rm', relative]);
  const removed = await runWorkspaceQualityExecution(loadStagedWorkspace(root), []);
  assert.equal(removed.exitCode, EXIT_CODES.success);
});

test('Java 测试文件归位规则与命名检查独立，移动到测试目录后通过', async (t) => {
  const root = fixture(t);
  const relative = 'apps/api/src/main/java/sample/UtilityTest.java';
  writeProjectFile(root, relative, 'package sample;\nclass UtilityTest {}\n');
  fixtureGit(root, ['add', relative]);
  const staged = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, relative)]);
  assert.equal(staged.exitCode, EXIT_CODES.violation);
  assert.equal(staged.decisiveResult.gateId, 'repository.file-placement');
  fixtureGit(root, ['rm', '-f', relative]);
  const corrected = 'apps/api/src/test/java/sample/UtilityTest.java';
  writeProjectFile(root, corrected, 'package sample;\nclass UtilityTest {}\n');
  fixtureGit(root, ['add', corrected]);
  const fixed = await runWorkspaceQualityExecution(loadStagedWorkspace(root), [path.join(root, corrected)]);
  assert.equal(fixed.exitCode, EXIT_CODES.success);
});

test('Java 构建配置保护覆盖新增、修改、删除及移出保护路径，不会被关闭通知降级', async (t) => {
  const root = fixture(t);
  const workspace = loadStagedWorkspace(root);
  const application = workspace.projects.find(({ id }) => id === 'api');
  for (const status of ['A', 'M', 'D', 'R100']) {
    const changes = createChangeSet({ source: 'test', changes: [{ status,
      path: status === 'R100' ? 'moved-pom.xml' : 'pom.xml',
      oldPath: status === 'R100' ? 'pom.xml' : null,
    }] });
    const context = { root: application.root, config: application.config, changes, step: { mutation: 'read-only' } };
    const result = await protectedFilesGate.run({ ...context, plan: protectedFilesGate.plan(context) });
    assert.equal(gateResultToExitCode(result), EXIT_CODES.violation, status);
  }
});
