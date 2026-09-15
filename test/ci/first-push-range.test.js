import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGitProjectFixture, fixtureGit as git } from '../helpers/git-project.js';
import { resolveCiRange } from '../../src/orchestration/ci/change-range.js';
import { gateStatusToExitCode, EXIT_CODES } from '../../src/core/result/exit-code.js';

function fixture(t) {
  const origin = createGitProjectFixture(t, { 'base.txt': '基线' });
  git(origin, ['branch', '-M', 'main']);
  const base = git(origin, ['rev-parse', 'HEAD']);
  const root = createGitProjectFixture(t, { 'placeholder.txt': '占位' });
  git(root, ['remote', 'add', 'origin', origin]);
  git(root, ['fetch', 'origin']);
  git(root, ['switch', '-C', 'feature', 'origin/main']);
  for (const file of ['first.txt', 'second.txt']) {
    writeFileSync(`${root}/${file}`, '功能提交');
    git(root, ['add', file]);
    git(root, ['commit', '-m', 'feat: 首次推送的功能提交']);
  }
  const head = git(root, ['rev-parse', 'HEAD']);
  const env = { GITLAB_CI: 'true', CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'feature',
    CI_DEFAULT_BRANCH: 'main', CI_COMMIT_BEFORE_SHA: '0'.repeat(40), CI_COMMIT_SHA: head };
  return { origin, root, base, head, env };
}

test('新分支首次推送获取最新默认分支共同祖先，包含所有功能提交', t => {
  const f = fixture(t);
  writeFileSync(`${f.origin}/later.txt`, '默认分支已前进');
  git(f.origin, ['add', '.']); git(f.origin, ['commit', '-m', 'feat: 默认分支前进']);
  const result = resolveCiRange(f.root, { env: f.env });
  assert.equal(result.base, f.base);
  assert.equal(result.head, f.head);
  assert.deepEqual(result.changes.map(change => change.path), ['first.txt', 'second.txt']);
  assert.equal(git(f.root, ['rev-parse', 'origin/main']), git(f.origin, ['rev-parse', 'HEAD']));
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.head);
  assert.equal(git(f.root, ['status', '--porcelain']), '');
});

test('普通推送和合并请求继续使用平台基准，显式错误基准不会被回退覆盖', t => {
  const f = fixture(t);
  git(f.root, ['remote', 'remove', 'origin']);
  assert.equal(resolveCiRange(f.root, { env: { ...f.env, CI_COMMIT_BEFORE_SHA: f.base } }).base, f.base);
  assert.equal(resolveCiRange(f.root, { env: { ...f.env, CI_PIPELINE_SOURCE: 'merge_request_event',
    CI_MERGE_REQUEST_DIFF_BASE_SHA: f.base } }).base, f.base);
  assert.throws(() => resolveCiRange(f.root, { base: 'missing', env: f.env }), { code: 'ci-range/base-revision-unavailable' });
  assert.throws(() => resolveCiRange(f.root, { base: '0'.repeat(40), env: f.env }), { code: 'ci-range/base-revision-unavailable' });
});

test('缺少必要环境、默认分支首推、手动作业及非法分支不猜测基准', t => {
  const f = fixture(t);
  for (const change of [{ CI_DEFAULT_BRANCH: '' }, { CI_COMMIT_BRANCH: 'main' },
    { CI_PIPELINE_SOURCE: 'web' }, { CI_COMMIT_BEFORE_SHA: '' }, { CI_COMMIT_BRANCH: '' }]) {
    assert.throws(() => resolveCiRange(f.root, { env: { ...f.env, ...change } }), { code: 'ci-range/base-revision-unavailable' });
  }
  assert.throws(() => resolveCiRange(f.root, { env: { ...f.env, CI_DEFAULT_BRANCH: '../invalid' } }), { code: 'ci-range/default-branch-invalid' });
});

test('浅克隆、无共同历史与获取失败分别阻断，不使用旧缓存冒充可信基准', t => {
  const f = fixture(t);
  const shallow = `${f.root}/shallow`;
  git(f.root, ['clone', '--depth=1', pathToFileURL(f.origin).href, shallow]);
  assert.throws(() => resolveCiRange(shallow, { env: { ...f.env, CI_COMMIT_SHA: f.base } }), { code: 'ci-range/history-incomplete' });
  git(f.origin, ['switch', '--orphan', 'unrelated']);
  writeFileSync(`${f.origin}/unrelated.txt`, '无关历史'); git(f.origin, ['add', '.']); git(f.origin, ['commit', '-m', 'test: 无关历史']);
  assert.throws(() => resolveCiRange(f.root, { env: { ...f.env, CI_DEFAULT_BRANCH: 'unrelated' } }), { code: 'ci-range/merge-base-unavailable' });
  git(f.root, ['remote', 'set-url', 'origin', `${f.root}/missing-origin`]);
  assert.throws(() => resolveCiRange(f.root, { env: f.env }), { code: 'git/command-failed', kind: 'execution' });
  assert.equal(gateStatusToExitCode('range-error'), EXIT_CODES.range);
});
