import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createProjectDocument } from '../../src/config/project-configuration.js';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

const CLI = fileURLToPath(new URL('../../bin/repo-guard.js', import.meta.url));
const GATE_ID = 'repository.global-file-placement';
const RULE = { name: 'SQL 文件', patterns: ['**/*.sql'], allowedPatterns: ['database/sql/**'], exceptions: [], suggestedDirectory: 'database/sql' };

function application(id, role, stack, preset) {
  const document = createProjectDocument({ id, role, stack, preset });
  for (const check of Object.values(document.checks)) check.enabled = false;
  document.repository.dependencyPolicy.enabled = false;
  document.repository.rules = [{ pattern: 'protected-config.txt', category: '团队规则', level: 'block' }];
  delete document.repository.commitMessage;
  delete document.repository.deliveryContract;
  delete document.repository.filePlacement;
  delete document.reporting;
  document.ci = { gatePolicy: { defaultMode: 'off' } };
  return JSON.stringify(document);
}

function fixture(t, { files = {}, mode = 'enforce' } = {}) {
  return createGitProjectFixture(t, {
    '.gitignore': 'reports/\n',
    'repo-guard.config.json': JSON.stringify({
      version: 2,
      projects: [{ id: 'web', root: 'apps/web' }, { id: 'api', root: 'services/api' }],
      repository: { rules: [{ pattern: 'protected-config.txt', category: '团队规则', level: 'block' }], commitMessage: { enabled: false }, filePlacement: { enabled: true, rules: [RULE] } },
      ci: { enabled: true, gatePolicy: { defaultMode: 'off', gates: { [GATE_ID]: { mode } } } },
      reporting: { notification: { enabled: false }, commitAnimation: { enabled: false } },
    }),
    'apps/web/repo-guard.config.json': application('web', 'frontend', 'node', 'vue-typescript'),
    'services/api/repo-guard.config.json': application('api', 'backend', 'java', 'java-maven'),
    'database/sql/schema.sql': 'select 1;\n',
    'notes.txt': '初始说明\n',
    ...files,
  });
}

function cli(root, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

function stageNote(root) {
  writeProjectFile(root, 'notes.txt', '只更新仓库公共说明\n');
  fixtureGit(root, ['add', 'notes.txt']);
}

test('真实提交入口覆盖公共目录和两个应用的历史错位 SQL，清理后通过', (t) => {
  const misplaced = ['apps/web/legacy.sql', 'services/api/legacy.SQL', 'shared/legacy.sql'];
  const root = fixture(t, { files: Object.fromEntries(misplaced.map((file) => [file, 'select 1;\n'])) });
  stageNote(root);
  const failed = cli(root, 'pre-commit');
  assert.equal(failed.status, EXIT_CODES.violation, failed.output);
  assert.ok(failed.output.includes(GATE_ID), failed.output);
  for (const file of misplaced) assert.ok(failed.output.includes(file), failed.output);
  fixtureGit(root, ['rm', ...misplaced]);
  const fixed = cli(root, 'pre-commit');
  assert.equal(fixed.status, EXIT_CODES.success, fixed.output);
});

test('未暂存的删文件或关闭根规则不能掩盖索引违规，手动检查按工作区执行', (t) => {
  const root = fixture(t, { files: { 'shared/legacy.sql': 'select 1;\n' } });
  rmSync(path.join(root, 'shared/legacy.sql'));
  stageNote(root);
  const current = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
  current.repository.filePlacement.enabled = false;
  writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(current));
  const staged = cli(root, 'pre-commit');
  assert.equal(staged.status, EXIT_CODES.violation, staged.output);
  assert.ok(staged.output.includes('shared/legacy.sql'), staged.output);
  const manual = cli(root, 'repository-file-placement', '--project', 'api');
  assert.equal(manual.status, EXIT_CODES.success, manual.output);
  assert.match(manual.output, /已关闭/);
});

test('手动命令从 Java 子目录仍检查整个仓库，未跟踪 SQL 也参与检查', (t) => {
  const root = fixture(t);
  writeProjectFile(root, 'shared/new.sql', 'select 1;\n');
  const result = cli(path.join(root, 'services/api'), 'repository-file-placement');
  assert.equal(result.status, EXIT_CODES.violation, result.output);
  assert.ok(result.output.includes('shared/new.sql'), result.output);
});

for (const mode of ['enforce', 'report']) {
  test(`CI 选择 Java 应用仍执行一次根规则，${mode} 模式保留统一违规证据`, (t) => {
    const root = fixture(t, { mode, files: { 'apps/web/legacy.sql': 'select 1;\n', 'shared/legacy.sql': 'select 1;\n' } });
    const base = fixtureGit(root, ['rev-parse', 'HEAD']);
    stageNote(root);
    fixtureGit(root, ['commit', '-m', 'test: 更新公共说明']);
    const head = fixtureGit(root, ['rev-parse', 'HEAD']);
    // 本地删除不改变 CI 所验证提交中的路径事实。
    rmSync(path.join(root, 'shared/legacy.sql'));
    const result = cli(root, 'ci', '--profile', 'policy', '--base', base, '--head', head, '--project', 'api');
    assert.equal(result.status, mode === 'enforce' ? EXIT_CODES.violation : EXIT_CODES.success, result.output);
    const report = JSON.parse(readFileSync(path.join(root, 'reports/repo-guard-workspace/repository.json'), 'utf8'));
    const matches = report.steps.filter(({ gateId, gateResult }) => (gateId ?? gateResult?.gateId) === GATE_ID);
    assert.equal(matches.length, 1, JSON.stringify(report));
    assert.equal(matches[0].gateResult.status, 'violation');
    assert.equal(matches[0].gateResult.metrics.violations, 2);
    const child = JSON.parse(readFileSync(path.join(root, 'services/api/reports/repo-guard-workspace/projects/api.json'), 'utf8'));
    assert.equal(child.steps.some(({ gateResult }) => gateResult?.gateId === GATE_ID), false);
  });
}

test('真实推送入口检查完整目标提交，公共目录修改不能漏掉历史错位 SQL', (t) => {
  const root = fixture(t, { files: { 'shared/legacy.sql': 'select 1;\n' } });
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  stageNote(root);
  fixtureGit(root, ['commit', '-m', 'test: 更新公共说明']);
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  const result = spawnSync(process.execPath, [CLI, 'pre-push', 'origin'], {
    cwd: root, input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, EXIT_CODES.violation, output);
  assert.ok(output.includes(GATE_ID), output);
  assert.ok(output.includes('shared/legacy.sql'), output);
});

test('单个 Java 应用的根规则通过手动、提交与无输入推送入口执行', (t) => {
  const document = JSON.parse(application('api', 'backend', 'java', 'java-maven'));
  document.repository.filePlacement = { enabled: true, rules: [RULE] };
  const root = createGitProjectFixture(t, {
    'repo-guard.config.json': JSON.stringify(document),
    'database/sql/schema.sql': 'select 1;\n',
    'notes.txt': '初始说明\n',
  });
  stageNote(root);
  for (const command of ['repository-file-placement', 'pre-commit', 'pre-push']) {
    const result = cli(root, command);
    assert.equal(result.status, EXIT_CODES.success, result.output);
    assert.match(result.output, /仓库级文件归位检查已通过/);
  }
});

test('推送附注标签时用标签指向的完整提交检查，不能把合法标签误判成范围错误', (t) => {
  const root = fixture(t);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  stageNote(root);
  fixtureGit(root, ['commit', '-m', 'test: 更新公共说明']);
  fixtureGit(root, ['tag', '-a', 'v2.0.0-test', '-m', '验证标签推送']);
  const tagObject = fixtureGit(root, ['rev-parse', 'v2.0.0-test']);
  const result = spawnSync(process.execPath, [CLI, 'pre-push', 'origin'], {
    cwd: root, input: `refs/tags/v2.0.0-test ${tagObject} refs/tags/v2.0.0-test ${base}\n`,
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, EXIT_CODES.success, output);
  assert.match(output, /通过\s+repository\.global-file-placement/);
});
