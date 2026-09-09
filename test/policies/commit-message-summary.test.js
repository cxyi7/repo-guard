import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createStarterConfig } from '../../src/orchestration/setup/config-management.js';
import { normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { runGit } from '../../src/git/execution.js';
import {
  cleanupCommitMessage,
  finalizeCommitMessage,
  prepareCommitMessage,
  readPreparedCommitMessage,
} from '../../src/policies/commit-message-summary.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function fixture(context) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'commit-message-state-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  writeFileSync(path.join(root, 'source.js'), 'export const ready = true;\n');
  runGit(['add', 'source.js'], { cwd: root });
  const messageFile = path.join(root, '.git', 'COMMIT_EDITMSG');
  writeFileSync(messageFile, 'feat: 创建功能\n');
  return {
    root,
    messageFile,
    stateFile: path.join(root, '.git', 'repo-guard-commit-message.json'),
    config: normalizeProjectDocument(createStarterConfig()),
  };
}

test('旧版、未知版本、缺少版本与无效 JSON 状态不读取、覆盖或清理', (context) => {
  const { root, stateFile, messageFile, config } = fixture(context);
  const originalMessage = readFileSync(messageFile, 'utf8');
  const originalIndex = readFileSync(path.join(root, '.git', 'index'));
  const rejected = [
    ...[1, 99, undefined].map((version) => `${JSON.stringify({ version, source: 'merge' })}\r\n`),
    '{无法解析的状态',
    'null',
  ];
  for (const content of rejected) {
    writeFileSync(stateFile, content);
    for (const action of [
      () => prepareCommitMessage(root, config, messageFile),
      () => readPreparedCommitMessage(root, messageFile),
      () => finalizeCommitMessage(root, config, messageFile),
      () => cleanupCommitMessage(root),
    ]) {
      assert.throws(action, { code: 'commit-message/unsupported-state-version' });
      assert.equal(readFileSync(stateFile, 'utf8'), content);
      assert.equal(readFileSync(messageFile, 'utf8'), originalMessage);
      assert.deepEqual(readFileSync(path.join(root, '.git', 'index')), originalIndex);
    }
  }
});

test('缺失状态仍按当前流程生成 v2，保留来源并可安全清理', (context) => {
  const { root, stateFile, messageFile, config } = fixture(context);
  assert.deepEqual(readPreparedCommitMessage(root, messageFile), {
    message: 'feat: 创建功能', source: '', sourceCommit: '',
  });
  prepareCommitMessage(root, config, messageFile, 'message');
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).version, 2);
  assert.equal(readPreparedCommitMessage(root, messageFile).source, 'message');
  finalizeCommitMessage(root, config, messageFile);
  assert.match(readFileSync(messageFile, 'utf8'), /【自动变更文件】/);
  cleanupCommitMessage(root);
  assert.equal(existsSync(stateFile), false);
  cleanupCommitMessage(root);

  finalizeCommitMessage(root, config, messageFile);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).version, 2);
  cleanupCommitMessage(root);
});

test('当前 v2 状态在索引变化后重新计算，不丢失提交来源', (context) => {
  const { root, stateFile, messageFile, config } = fixture(context);
  prepareCommitMessage(root, config, messageFile, 'merge');
  const before = JSON.parse(readFileSync(stateFile, 'utf8'));
  writeFileSync(path.join(root, 'second.js'), 'export const second = true;\n');
  runGit(['add', 'second.js'], { cwd: root });
  finalizeCommitMessage(root, config, messageFile);
  const after = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(after.version, 2);
  assert.notEqual(after.indexTree, before.indexTree);
  assert.equal(after.source, 'merge');
  assert.equal(after.changes.length, 2);
});

test('提交成功后遇到旧版状态仅警告，保留文件和真实提交并返回成功', (context) => {
  const { root, stateFile } = fixture(context);
  runGit(['-c', 'user.name=测试', '-c', 'user.email=test@example.com', 'commit', '-m', 'feat: 创建功能'], { cwd: root });
  const committedHead = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout;
  for (const version of [1, 99]) {
    const content = `${JSON.stringify({ version, source: 'message' })}\r\n`;
    writeFileSync(stateFile, content);
    const result = spawnSync(process.execPath, [path.resolve('bin/repo-guard.js'), 'hook-message', 'success'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /警告：Git 提交已完成/);
    assert.match(result.stderr, /commit-message\/unsupported-state-version/);
    assert.match(result.stderr, /状态已保留/);
    assert.equal(readFileSync(stateFile, 'utf8'), content);
    assert.equal(runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout, committedHead);
  }
});
