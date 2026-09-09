import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createChangeSet, createGateContext } from '../../src/core/capability/gate-context.js';
import { collectRevisionChanges, collectStagedChanges, collectWorkingTreeChanges } from '../../src/git/change-collection.js';
import { listIndexFiles, readIndexTextFiles, readIndexFileBuffer } from '../../src/git/index-content.js';
import { listIndexBinaryEntries, listRevisionBinaryEntries, readGitBlobs } from '../../src/git/binary-content.js';
import { readFileAtRevision, isTrackedPath } from '../../src/git/revision-content.js';
import { readStagedPackageMetadata } from '../../src/git/staged-package-metadata.js';
import { collectTrackedProjectPaths } from '../../src/git/tracked-paths.js';
import { readFileAtRevision as readContractFileAtRevision, listFilesAtRevision } from '../../src/git/delivery-contract-facts.js';
import { collectProjectFiles } from '../../src/policies/file-placement.js';
import { evaluateMaxFileLines } from '../../src/policies/max-file-lines.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

function createApplications(t) {
  const files = Object.fromEntries(['', 'apps/web/', 'apps/api/'].flatMap((prefix) => [
    [`${prefix}src/shared.js`, `export const source = '${prefix || 'repository'}';\n`],
    [`${prefix}package.json`, JSON.stringify({ name: prefix || 'repository', version: '1.0.0' })],
    [`${prefix}package-lock.json`, JSON.stringify({ name: prefix || 'repository', lockfileVersion: 3 })],
  ]));
  const root = createGitProjectFixture(t, files);
  return { root, web: path.join(root, 'apps/web'), api: path.join(root, 'apps/api') };
}

test('应用暂存读取与历史快照不会误取仓库根或另一应用的同名文件', (t) => {
  const { root, web, api } = createApplications(t);
  writeProjectFile(web, 'src/shared.js', "export const source = 'web-staged';\n");
  writeProjectFile(web, 'package.json', JSON.stringify({ name: 'web-staged', version: '1.1.0' }));
  fixtureGit(web, ['add', '.']);
  writeProjectFile(web, 'src/shared.js', "export const source = 'web-unstaged';\n");
  writeProjectFile(api, 'src/shared.js', "export const source = 'api-staged';\n");
  fixtureGit(api, ['add', '.']);

  assert.equal(readIndexTextFiles(web, ['src/shared.js'])[0].content, "export const source = 'web-staged';\n");
  assert.equal(readIndexFileBuffer(web, 'src/shared.js').toString(), "export const source = 'web-staged';\n");
  assert.equal(readFileAtRevision(web, 'HEAD', 'src/shared.js').content, "export const source = 'apps/web/';\n");
  assert.equal(readFileAtRevision(root, 'HEAD', 'src/shared.js').content, "export const source = 'repository';\n");
  assert.equal(readFileAtRevision(api, 'HEAD', 'src/shared.js').content, "export const source = 'apps/api/';\n");
  assert.equal(JSON.parse(readStagedPackageMetadata(web).packageJson).name, 'web-staged');
  assert.equal(JSON.parse(readStagedPackageMetadata(web).lockfile).name, 'apps/web/');
  assert.deepEqual(listIndexFiles(web).sort(), ['package-lock.json', 'package.json', 'src/shared.js']);
  assert.deepEqual(collectTrackedProjectPaths(web).sort(), listIndexFiles(web).sort());
  assert.equal(isTrackedPath(web, 'src/shared.js'), true);
  const webChange = collectWorkingTreeChanges(web).find(({ path: file }) => file === 'src/shared.js');
  assert.deepEqual(webChange.states, ['staged', 'unstaged']);
  assert.ok(collectStagedChanges(root).some(({ path: file }) => file === 'apps/api/src/shared.js'));
});

test('索引和提交对象列表都保持应用相对路径与准确内容', (t) => {
  const { web } = createApplications(t);
  const indexEntries = listIndexBinaryEntries(web);
  const revisionEntries = listRevisionBinaryEntries(web, 'HEAD');
  assert.deepEqual(indexEntries.map(({ path: file }) => file).sort(), ['package-lock.json', 'package.json', 'src/shared.js']);
  assert.deepEqual(revisionEntries.map(({ path: file }) => file).sort(), indexEntries.map(({ path: file }) => file).sort());
  assert.equal(readGitBlobs(web, revisionEntries).get('src/shared.js').toString(), "export const source = 'apps/web/';\n");
  assert.equal(readContractFileAtRevision(web, 'HEAD', 'src/shared.js')?.toString(), "export const source = 'apps/web/';\n");
  assert.deepEqual(listFilesAtRevision(web, 'HEAD', 'src'), ['src/shared.js']);
});

test('跨应用重命名在源应用是删除、目标应用是新增，仓库仍保留完整重命名', (t) => {
  const { root, web, api } = createApplications(t);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  fixtureGit(root, ['mv', 'apps/web/src/shared.js', 'apps/api/src/moved.js']);
  assert.deepEqual(collectStagedChanges(web), [{ status: 'D', oldPath: null, path: 'src/shared.js' }]);
  assert.deepEqual(collectStagedChanges(api), [{ status: 'A', oldPath: null, path: 'src/moved.js' }]);
  assert.deepEqual(collectStagedChanges(root), [{ status: 'R100', oldPath: 'apps/web/src/shared.js', path: 'apps/api/src/moved.js' }]);
  fixtureGit(root, ['commit', '-m', 'test: 跨应用移动文件']);
  assert.deepEqual(collectRevisionChanges(web, base).map(({ status, path: file }) => [status, file]), [['D', 'src/shared.js']]);
  assert.deepEqual(collectRevisionChanges(api, base).map(({ status, path: file }) => [status, file]), [['A', 'src/moved.js']]);
});

test('文件扫描限定应用并保留未跟踪文件，同时排除工作区删除文件', (t) => {
  const { root, web, api } = createApplications(t);
  writeProjectFile(web, 'src/new.js', 'export const web = true;\n');
  writeProjectFile(api, 'src/other.js', 'export const api = true;\n');
  writeProjectFile(root, 'src/root-only.js', 'export const root = true;\n');
  unlinkSync(path.join(web, 'src/shared.js'));
  assert.deepEqual(collectProjectFiles(web).sort(), ['package-lock.json', 'package.json', 'src/new.js']);
  assert.deepEqual(collectWorkingTreeChanges(web).map(({ path: file }) => file).sort(), ['src/new.js', 'src/shared.js']);
});

test('行数不回退检查使用应用自身的基线', (t) => {
  const root = createGitProjectFixture(t, {
    'src/shared.js': 'root\n'.repeat(100),
    'apps/api/src/shared.js': 'api\n'.repeat(7),
  });
  const api = path.join(root, 'apps/api');
  writeProjectFile(api, 'src/shared.js', 'api\n'.repeat(8));
  const result = evaluateMaxFileLines({
    root: api,
    files: [path.join(api, 'src/shared.js')],
    config: { mode: 'noRegression', exclusions: [], rules: [{ pattern: 'src/**', maxLines: 5 }] },
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].baselineLineCount, 7);
  assert.equal(result.violations[0].path, 'src/shared.js');
});

test('执行上下文分别保存仓库与应用范围，不改写原始变更', () => {
  const changes = createChangeSet({ source: 'staged', changes: [{ status: 'M', path: 'src/shared.js', oldPath: null }] });
  const context = createGateContext({ root: 'workspace/apps/api', repositoryRoot: 'workspace', project: { id: 'api', role: 'backend', stack: 'node' }, environment: 'ci', config: {}, changes });
  assert.equal(context.root, 'workspace/apps/api');
  assert.equal(context.repositoryRoot, 'workspace');
  assert.equal(context.project.id, 'api');
  assert.equal(Object.isFrozen(context.project), true);
  assert.deepEqual(context.changes.entries, [{ status: 'M', path: 'src/shared.js', oldPath: null }]);
});
