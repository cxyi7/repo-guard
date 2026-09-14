import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { installGitLabCi } from '../../src/orchestration/setup/gitlab-ci.js';

function fixture(context) {
  const base = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'quality-ci-upgrade-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'npm@10.9.8', devDependencies: { '@cxyi7/repo-guard': '2.0.0' } }));
  writeFileSync(path.join(root, 'package-lock.json'), '{}');
  writeFileSync(path.join(root, 'repo-guard.config.json'), JSON.stringify({
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
    ci: { enabled: true, },
  }));
  return root;
}

test('安装按项目配置生成唯一 CI 入口', (context) => {
  const root = fixture(context);
  const result = installGitLabCi(root);
  assert.equal(result.integrated, true);
  assert.equal(Object.hasOwn(result, 'profile'), false);
  const document = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
  assert.equal(Object.hasOwn(document.ci, 'profile'), false);
  assert.match(readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8'), /extends: \.repo_guard_ci/);
});

test('根集成冲突和预览均不写入质量配置', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'repo-guard.config.json');
  const original = readFileSync(file, 'utf8');
  installGitLabCi(root, { dryRun: true });
  assert.equal(readFileSync(file, 'utf8'), original);
  writeFileSync(path.join(root, '.gitlab-ci.yml'), 'include:\n  - local: /team-pipeline.yml\n');
  assert.equal(installGitLabCi(root, { }).integrated, false);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('调整触发分支后可更新未修改的当前模板，人工修改仍被保护', (context) => {
  const root = fixture(context);
  installGitLabCi(root);
  const file = path.join(root, 'repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.ci.branches = ['dev', 'release/candidate'];
  writeFileSync(file, JSON.stringify(document));
  const template = path.join(root, '.gitlab/ci/repo-guard.yml');
  const before = readFileSync(template, 'utf8');
  assert.equal(installGitLabCi(root, { dryRun: true }).templateChanged, true);
  assert.equal(readFileSync(template, 'utf8'), before);
  assert.equal(installGitLabCi(root).templateChanged, true);
  const after = readFileSync(template, 'utf8');
  assert.ok(after.includes(JSON.stringify('$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "release/candidate"')));
  assert.equal(after.includes(JSON.stringify('$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"')), false);
  assert.equal(installGitLabCi(root).templateChanged, false);
  writeFileSync(template, after.replace('repo-guard ci', 'repo-guard ci || true'));
  assert.throws(() => installGitLabCi(root), /拒绝覆盖/);
});
