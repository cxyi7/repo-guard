import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadWorkspace } from '../../../src/config/workspace-configuration.js';
import { dynamicCodeGate } from '../../../src/gates/security/dynamic-code-gate.js';

function dateText(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function approval(id, file) {
  return {
    id, rule: 'security/no-eval', path: file, line: 1, column: 1,
    owner: '工程团队', approvedBy: '规范负责人', reason: '限定范围的临时兼容例外',
    ticket: 'ENGINEERING-1', createdOn: dateText(-1), expiresOn: dateText(20),
  };
}

function fixture(context, declarations, entriesByApplication) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-app-exceptions-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const document = { version: 2, projects: declarations };
  writeFileSync(path.join(root, 'repo-guard.config.json'), JSON.stringify(document));
  for (const project of declarations) {
    const directory = path.join(root, project.root);
    mkdirSync(path.join(directory, 'src'), { recursive: true });
    writeFileSync(path.join(directory, 'src/runtime.js'), "eval('legacy');\n");
    writeFileSync(path.join(directory, project.config), JSON.stringify({
      version: 2, project: { id: project.id, role: 'backend', stack: 'node', preset: 'node-javascript' },
      repository: { exceptions: { entries: entriesByApplication[project.id] ?? [] } },
    }));
  }
  return root;
}

function inspect(project) {
  const files = ['src/runtime.js'];
  const plan = dynamicCodeGate.plan({ root: project.root, files });
  return dynamicCodeGate.run({ root: project.root, config: project.config, plan });
}

test('应用例外只放行本应用，同名文件不能跨应用套用且根入口不接受例外', (context) => {
  const entries = [approval('api-approved', 'src/runtime.js')];
  const root = fixture(context, ['api', 'worker'].map((id) => ({ id, root: `apps/${id}`, config: 'guard.project.json' })), { api: entries });
  const original = readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8');
  for (const options of [{}, { readDocument: (relative) => readFileSync(path.join(root, relative), 'utf8') }]) {
    const workspace = loadWorkspace(root, options);
    assert.deepEqual(workspace.repositoryConfig.repository.exceptions.entries, []);
    const [api, worker] = workspace.projects;
    assert.deepEqual(api.config.repository.exceptions.entries.map(({ id, path: file }) => ({ id, path: file })), [{ id: 'api-approved', path: 'src/runtime.js' }]);
    assert.deepEqual(worker.config.repository.exceptions.entries, []);
    const approved = inspect(api);
    assert.equal(approved.status, 'passed', approved.summary);
    assert.equal(approved.metrics.approvedExceptions, 1);
    assert.match(approved.diagnostics[0].message, /api-approved/);
    assert.equal(inspect(worker).status, 'violation');
  }
  assert.equal(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'), original);
  writeFileSync(path.join(root, 'repo-guard.config.json'), JSON.stringify({ ...JSON.parse(original), repository: { exceptions: { entries } } }));
  assert.throws(() => loadWorkspace(root), /仓库公共 repository 包含不支持的属性： exceptions/);
});

test('根目录应用保留完整相对路径，例外的单应用语义不变', (context) => {
  const entries = [approval('api-approved', 'src/runtime.js')];
  const root = fixture(context, [{ id: 'api', root: '.', config: 'guard.project.json' }], { api: entries });
  const { projects, repositoryConfig } = loadWorkspace(root);
  assert.deepEqual(projects[0].config.repository.exceptions.entries, entries);
  assert.deepEqual(repositoryConfig.repository.exceptions.entries, []);
  assert.equal(inspect(projects[0]).status, 'passed');
});
