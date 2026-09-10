import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createQualityResultChannel, beginQualityResult } from '../../src/orchestration/pre-commit/quality-result-channel.js';
import { aggregateExitCodes } from '../../src/core/result/exit-code.js';
import { createGitProjectFixture } from '../helpers/git-project.js';

function fixture(context) {
  const root = createGitProjectFixture(context, { 'value.txt': '初始内容\n' });
  const channel = createQualityResultChannel(root);
  context.after(() => channel.close());
  const directory = path.join(realpathSync(tmpdir()), `repo-guard-quality-${channel.id}`);
  return { root, channel, directory };
}

test('内部通道按运行隔离，并保留完整的中央退出码分类', (context) => {
  const { root, channel } = fixture(context);
  const second = createQualityResultChannel(root);
  context.after(() => second.close());
  for (const code of [0, 2, 3]) beginQualityResult(channel.id, root)(code);
  assert.deepEqual(channel.readExitCodes().sort(), [0, 2, 3]);
  assert.equal(aggregateExitCodes(channel.readExitCodes()), 3);
  assert.deepEqual(second.readExitCodes(), []);
  beginQualityResult(channel.id, root)(1);
  assert.equal(aggregateExitCodes(channel.readExitCodes()), 1);
});

test('内部通道拒绝路径参数和其他仓库，并且不会覆盖已有文件', (context) => {
  const { root, channel, directory } = fixture(context);
  const otherRoot = createGitProjectFixture(context, { 'value.txt': '另一个仓库\n' });
  assert.throws(() => beginQualityResult('../outside.json', root), /运行标识格式/);
  assert.throws(() => beginQualityResult(channel.id, otherRoot), /当前仓库/);
  const request = readFileSync(path.join(directory, 'request.json'), 'utf8');
  const finish = beginQualityResult(channel.id, root);
  finish(2);
  assert.throws(() => finish(0), /内部结果通道/);
  assert.equal(readFileSync(path.join(directory, 'request.json'), 'utf8'), request);
  assert.deepEqual(channel.readExitCodes(), [2]);
});

test('子任务中断不能被其他子任务的违规记录掩盖', (context) => {
  const { root, channel } = fixture(context);
  beginQualityResult(channel.id, root)(2);
  beginQualityResult(channel.id, root);
  assert.throws(() => channel.readExitCodes(), /未完整返回结果/);
});

test('内部通道拒绝旧协议及第三方未知退出码', (context) => {
  const { root, channel, directory } = fixture(context);
  const finish = beginQualityResult(channel.id, root);
  assert.throws(() => finish(17), /内部结果通道/);
  finish(2);
  const resultName = readdirSync(directory).find((name) => name.endsWith('.result.json'));
  const resultPath = path.join(directory, resultName);
  const record = JSON.parse(readFileSync(resultPath, 'utf8'));
  writeFileSync(resultPath, JSON.stringify({ ...record, version: 1 }));
  assert.throws(() => channel.readExitCodes(), /记录格式/);
});

test('内部通道拒绝目录链接，不能把结果写到链接目标', (context) => {
  const { root, channel, directory } = fixture(context);
  const target = path.join(root, 'outside-channel');
  mkdirSync(target);
  const request = readFileSync(path.join(directory, 'request.json'));
  writeFileSync(path.join(target, 'request.json'), request);
  rmSync(directory, { recursive: true });
  symlinkSync(target, directory, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    assert.throws(() => beginQualityResult(channel.id, root), /独立真实目录/);
    assert.deepEqual(readdirSync(target), ['request.json']);
  } finally {
    rmSync(directory);
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'request.json'), request);
  }
});
