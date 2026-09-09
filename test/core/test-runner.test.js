import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectTestFiles, parseTestArguments, runTests } from '../../scripts/run-tests.mjs';

function createRepository(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-guard-test-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

test('只收集登记组的测试，排除根目录、样例、辅助和生成文件', (t) => {
  const root = createRepository(t, {
    'test/core/execution.test.js': '',
    'test/gates/testing/unit.test.js': '',
    'test/config/schema.test.js': '',
    'test/root.test.js': '',
    'test/unknown/unknown.test.js': '',
    'test/fixtures/fixture.test.js': '',
    'test/core/fixtures/sample.test.js': '',
    'test/core/helpers/helper.test.js': '',
    'test/core/.tmp/generated.test.js': '',
    'test/core/node_modules/vendor.test.js': '',
    'test/core/helper.js': '',
  });
  const files = collectTestFiles(root, parseTestArguments([]));
  assert.deepEqual(files.map((file) => path.relative(root, file).replaceAll('\\', '/')), [
    'test/config/schema.test.js',
    'test/core/execution.test.js',
    'test/gates/testing/unit.test.js',
  ]);
});

test('支持组合分组和 Node 并发参数，重复分组不重复执行', (t) => {
  const root = createRepository(t, { 'test/gates/testing/unit.test.js': '' });
  const options = parseTestArguments(['--suite=gates,gates/testing', '--test-concurrency=4', '--test-name-pattern', '中文 空格']);
  assert.deepEqual(options.nodeArguments, ['--test-concurrency=4', '--test-name-pattern', '中文 空格']);
  assert.equal(collectTestFiles(root, options).length, 1);
});

test('未知分组、路径穿越、空分组及非法并发参数必须失败', (t) => {
  const root = createRepository(t, {});
  for (const argumentsList of [['--suite=../fixtures'], ['--suite'], ['--suite=unknown'], ['--test-concurrency=0'], ['--test-concurrency'], ['--eval=process.exit(0)']]) {
    assert.throws(() => parseTestArguments(argumentsList), TypeError);
  }
  assert.throws(() => collectTestFiles(root, parseTestArguments([])), /没有找到可执行的测试/);
  assert.throws(() => collectTestFiles(root, parseTestArguments(['--suite=core'])), /没有找到/);
});

test('命令使用独立参数和固定工作目录，并保留子进程退出码', (t) => {
  const root = createRepository(t, { 'test/core/包含 空格.test.js': '' });
  const status = runTests(['--suite=core', '--test-concurrency', '4'], {
    repositoryRoot: root,
    spawn(command, argumentsList, options) {
      assert.equal(command, process.execPath);
      assert.deepEqual(argumentsList, ['--test', '--test-concurrency', '4', path.join(root, 'test/core/包含 空格.test.js')]);
      assert.equal(options.shell, false);
      assert.equal(options.cwd, root);
      assert.equal(options.env.NODE_TEST_CONTEXT, undefined);
      return { status: 7 };
    },
  });
  assert.equal(status, 7);
  assert.equal(runTests([], { repositoryRoot: root, spawn: () => ({ status: null, signal: 'SIGTERM' }) }), 143);
  assert.throws(() => runTests([], { repositoryRoot: root, spawn: () => ({ error: new TypeError('模拟启动失败') }) }), /无法启动测试/);
});

test('真实 Node 执行可以发现失败并返回非零结果', (t) => {
  const root = createRepository(t, {
    'test/core/failure.test.js': "require('node:test')('失败用例', () => { require('node:assert/strict').equal(1, 2); });\n",
  });
  let output = '';
  const status = runTests(['--suite=core', '--test-concurrency=4'], {
    repositoryRoot: root,
    spawn(command, argumentsList, options) {
      const result = spawnSync(command, argumentsList, { ...options, stdio: 'pipe', encoding: 'utf8' });
      output = result.stdout;
      return result;
    },
  });
  assert.equal(status, 1);
  assert.match(output, /失败用例/);
});
