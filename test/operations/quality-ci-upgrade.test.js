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
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@cxyi7/repo-guard': '2.0.0' } }));
  writeFileSync(path.join(root, 'package-lock.json'), '{}');
  writeFileSync(path.join(root, 'repo-guard.config.json'), JSON.stringify({
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
    ci: { enabled: true, profile: 'full' },
  }));
  return root;
}

test('安装未指定 profile 时沿用既有 full 并保持配置与生成模板一致', (context) => {
  const root = fixture(context);
  const result = installGitLabCi(root);
  assert.equal(result.integrated, true);
  assert.equal(result.profile, 'full');
  const document = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
  assert.equal(document.ci.profile, 'full');
  assert.match(readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8'), /extends: \.repo_guard_full/);
});

test('根集成冲突和预览均不写入质量配置或误改 profile', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'repo-guard.config.json');
  const original = readFileSync(file, 'utf8');
  installGitLabCi(root, { profile: 'policy', dryRun: true });
  assert.equal(readFileSync(file, 'utf8'), original);
  writeFileSync(path.join(root, '.gitlab-ci.yml'), 'include:\n  - local: /team-pipeline.yml\n');
  assert.equal(installGitLabCi(root, { profile: 'policy' }).integrated, false);
  assert.equal(readFileSync(file, 'utf8'), original);
});
