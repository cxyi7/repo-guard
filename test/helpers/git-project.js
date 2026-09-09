import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMP_ROOT = fileURLToPath(new URL('../.tmp/', import.meta.url));

export function fixtureGit(root, argumentsList) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...argumentsList], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function writeProjectFile(root, relative, content) {
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(`${path.resolve(root)}${path.sep}`), '样例文件必须位于指定目录内');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function createGitProjectFixture(t, files) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const root = mkdtempSync(path.join(TEMP_ROOT, 'git-project-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(`${path.resolve(TEMP_ROOT)}${path.sep}`));
    rmSync(root, { recursive: true, force: true });
  });
  fixtureGit(root, ['init']);
  fixtureGit(root, ['config', 'user.name', 'repo-guard test']);
  fixtureGit(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  fixtureGit(root, ['config', 'commit.gpgsign', 'false']);
  fixtureGit(root, ['config', 'core.hooksPath', path.join(root, '.git', 'fixture-hooks')]);
  for (const [relative, content] of Object.entries(files)) writeProjectFile(root, relative, content);
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 初始化应用样例']);
  return root;
}
