import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_COMMIT_MESSAGE_CONFIG } from '../src/config/defaults.js';
import {
  commitMessageGate,
  createCommitMessageResult,
} from '../src/gates/repository/commit-message-gate.js';
import {
  collectCommitMessages,
  collectPendingCommitParents,
} from '../src/git/commit-messages.js';
import { runHookMessage } from '../src/orchestration/commit-message/runner.js';
import { createStarterConfig } from '../src/orchestration/setup/config-management.js';
import { inspectCommitMessage, normalizeCommitMessage } from '../src/policies/commit-message.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function policy(overrides = {}) {
  return {
    ...DEFAULT_COMMIT_MESSAGE_CONFIG,
    ...overrides,
    breakingChange: {
      ...DEFAULT_COMMIT_MESSAGE_CONFIG.breakingChange,
      ...(overrides.breakingChange ?? {}),
    },
    merge: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.merge, ...(overrides.merge ?? {}) },
    revert: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.revert, ...(overrides.revert ?? {}) },
    fixup: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.fixup, ...(overrides.fixup ?? {}) },
  };
}

function inspect(message, overrides = {}, environment = 'local', context = {}) {
  return inspectCommitMessage({ message, parents: [], ...context }, policy(overrides), environment);
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'commit-message-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.test']);
  return root;
}

function commitFile(root, file, content, message) {
  writeFileSync(path.join(root, file), content);
  git(root, ['add', '--', file]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

test('accepts configured Conventional Commit headers and reports stable rule ids', () => {
  const accepted = inspect('feat(auth): 增加登录校验', {
    types: ['feat', 'fix'],
    requireScope: true,
    allowedScopes: ['auth'],
  });
  assert.equal(accepted.kind, 'conventional');
  assert.deepEqual(accepted.issues, []);

  const rejected = inspect('docs(api): update docs', {
    types: ['feat', 'fix'],
    requireScope: true,
    allowedScopes: ['auth'],
  });
  assert.deepEqual(
    rejected.issues.map(({ rule }) => rule),
    ['commit-message/type', 'commit-message/scope'],
  );

  const missingScope = inspect('fix: 修复登录失败', { requireScope: true });
  assert.deepEqual(
    missingScope.issues.map(({ rule }) => rule),
    ['commit-message/scope-required'],
  );
});

test('counts Unicode code points and removes Git comments before validation', () => {
  const normalized = normalizeCommitMessage(
    '\uFEFFfix: 修复问题\r\n; Git 生成的说明\r\n正文\r\n; ------------------------ >8 ------------------------\r\n忽略',
    ';',
  );
  assert.equal(normalized, 'fix: 修复问题\n正文');
  assert.equal(
    normalizeCommitMessage('# 已提交的真实标题\nfeat: 不得跳过'),
    '# 已提交的真实标题\nfeat: 不得跳过',
  );
  assert.deepEqual(
    inspect('# 已提交的真实标题\nfeat: 不得跳过').issues.map(({ rule }) => rule),
    ['commit-message/format'],
  );

  const result = inspect('fix: 一二三四五六', { headerMaxLength: 10 });
  assert.deepEqual(
    result.issues.map(({ rule }) => rule),
    ['commit-message/header-length'],
  );
});

test('requires both breaking-change declarations and enforces major version at release time', () => {
  assert.deepEqual(
    inspect('feat: 调整接口\n\nBREAKING CHANGE: 删除旧字段').issues.map(({ rule }) => rule),
    ['commit-message/breaking-marker'],
  );
  assert.deepEqual(
    inspect('feat!: 调整接口').issues.map(({ rule }) => rule),
    ['commit-message/breaking-footer'],
  );

  const record = {
    sha: '1234567890abcdef',
    parents: [],
    message: 'feat!: 调整接口\n\nBREAKING CHANGE: 删除旧字段',
  };
  const blocked = createCommitMessageResult({
    records: [record],
    config: policy(),
    environment: 'release-ready',
    previousVersion: '1.8.0',
    currentVersion: '1.9.0',
  });
  assert.equal(blocked.status, 'violation');
  assert.deepEqual(
    blocked.findings.map(({ ruleId }) => ruleId),
    ['commit-message/breaking-version'],
  );

  const passed = createCommitMessageResult({
    records: [record],
    config: policy(),
    environment: 'release-ready',
    previousVersion: '1.8.0',
    currentVersion: '2.0.0',
  });
  assert.equal(passed.status, 'passed');
});

test('handles merge, revert, fixup and squash according to their lifecycle', () => {
  assert.deepEqual(
    inspect('Merge branch feature', {}, 'local', { source: 'merge' }).issues.map(({ rule }) => rule),
    ['commit-message/format'],
  );
  assert.equal(inspect('arbitrary merge title', {}, 'ci-full', { parents: ['a', 'b'] }).kind, 'merge');
  assert.deepEqual(
    inspect('Merge branch feature').issues.map(({ rule }) => rule),
    ['commit-message/format'],
  );

  const revert = inspect('Revert "feat: 增加登录"\n\nThis reverts commit abcdef1234567.');
  assert.equal(revert.kind, 'revert');
  assert.deepEqual(revert.issues, []);
  assert.equal(inspect(
    'Revert "feat: 增加登录"\n\nThis reverts commit abcdef1234567.',
    {},
    'local',
    { source: 'merge' },
  ).kind, 'revert');
  assert.deepEqual(
    inspect('Revert "feat: 增加登录"').issues.map(({ rule }) => rule),
    ['commit-message/revert-format'],
  );

  assert.deepEqual(inspect('fixup! feat(auth): 增加登录', {}, 'local').issues, []);
  assert.deepEqual(
    inspect('fixup! feat(auth): 增加登录', {}, 'pre-push').issues.map(({ rule }) => rule),
    ['commit-message/temporary-commit'],
  );
  assert.deepEqual(
    inspect('squash! invalid target', {}, 'ci-full').issues.map(({ rule }) => rule),
    ['commit-message/temporary-commit', 'commit-message/format'],
  );
  assert.deepEqual(
    inspect('fixup! feat: 一二三四', { headerMaxLength: 15 }).issues.map(({ rule }) => rule),
    ['commit-message/header-length'],
  );
});

test('identifies a pending local merge from MERGE_HEAD instead of the Hook source label', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitFile(root, 'base.txt', 'base', 'chore: 初始化');
  const primaryBranch = git(root, ['branch', '--show-current']);
  git(root, ['switch', '-q', '-c', 'feature']);
  commitFile(root, 'feature.txt', 'feature', 'feat: 增加功能');
  git(root, ['switch', '-q', primaryBranch]);

  assert.deepEqual(collectPendingCommitParents(root), []);
  git(root, ['merge', '--no-commit', '--no-ff', 'feature']);
  const parents = collectPendingCommitParents(root);
  assert.equal(parents.length, 2);
  assert.equal(inspect('Merge branch feature', {}, 'local', { parents }).kind, 'merge');
});

test('collects exactly the commits in a Git revision range in chronological order', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const base = commitFile(root, 'first.txt', 'first', 'chore: 初始化');
  const first = commitFile(root, 'second.txt', 'second', 'feat: 增加第二个文件');
  const head = commitFile(root, 'third.txt', 'third', 'fix: 修复第三个文件');

  const records = collectCommitMessages(root, { base, head });
  assert.deepEqual(records.map(({ sha }) => sha), [first, head]);
  assert.match(records[0].message, /^feat: 增加第二个文件/u);
  assert.deepEqual(records[1].parents, [first]);
  assert.equal(Object.isFrozen(records), true);
});

test('release-ready compares package versions from the Git base and head instead of the working tree', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const base = commitFile(
    root,
    'package.json',
    '{"name":"release-fixture","version":"1.0.0"}\n',
    'chore: 初始化',
  );
  writeFileSync(path.join(root, 'package.json'), '{"name":"release-fixture","version":"1.1.0"}\n');
  git(root, ['add', '--', 'package.json']);
  git(root, [
    'commit',
    '-q',
    '-m',
    'feat!: 调整公共接口',
    '-m',
    'BREAKING CHANGE: 删除旧接口',
  ]);
  const breakingHead = git(root, ['rev-parse', 'HEAD']);

  writeFileSync(path.join(root, 'package.json'), '{"name":"release-fixture","version":"2.0.0"}\n');
  const blocked = commitMessageGate.run({
    root,
    config: { commitMessage: policy() },
    environment: 'release-ready',
    plan: { enabled: true, revision: { base, head: breakingHead } },
  });
  assert.equal(blocked.status, 'violation');
  assert.deepEqual(blocked.findings.map(({ ruleId }) => ruleId), [
    'commit-message/breaking-version',
  ]);

  git(root, ['add', '--', 'package.json']);
  git(root, ['commit', '-q', '-m', 'chore: 提升主版本']);
  const releaseHead = git(root, ['rev-parse', 'HEAD']);
  const passed = commitMessageGate.run({
    root,
    config: { commitMessage: policy() },
    environment: 'release-ready',
    plan: { enabled: true, revision: { base, head: releaseHead } },
  });
  assert.equal(passed.status, 'passed');
});

test('commit-msg validates the human message before finalizing the automatic file summary', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitFile(root, 'first.txt', 'first', 'chore: 初始化');
  writeFileSync(path.join(root, 'second.txt'), 'second');
  git(root, ['add', '--', 'second.txt']);

  const config = createStarterConfig();
  config.commitMessage.enabled = true;
  writeFileSync(path.join(root, 'repo-guard.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const messageFile = path.join(root, '.git', 'COMMIT_EDITMSG');
  writeFileSync(messageFile, 'invalid title\n');

  assert.equal(runHookMessage(['prepare', messageFile], root), 0);
  assert.equal(runHookMessage(['finalize', messageFile], root), 2);
  assert.match(readFileSync(messageFile, 'utf8'), /repo-guard:files:start/u);

  writeFileSync(
    messageFile,
    readFileSync(messageFile, 'utf8').replace('invalid title', 'feat: 增加第二个文件'),
  );
  assert.equal(runHookMessage(['finalize', messageFile], root), 0);
  const finalized = readFileSync(messageFile, 'utf8');
  assert.doesNotMatch(finalized, /repo-guard:files:start/u);
  assert.match(finalized, /^feat: 增加第二个文件/u);
  assert.match(finalized, /【自动变更文件】/u);
});
