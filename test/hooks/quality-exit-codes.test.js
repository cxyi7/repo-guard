import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runQualityGate } from '../../src/orchestration/pre-commit/lint-staged-gate.js';
import { runQualityFileCommand } from '../../src/orchestration/pre-commit/quality-command.js';
import { createGitProjectFixture, fixtureGit } from '../helpers/git-project.js';
import { stringifyProjectFixture } from '../helpers/project-config.js';

const CLI = fileURLToPath(new URL('../../bin/repo-guard.js', import.meta.url));
const ERRORS = new URL('../../src/core/error/repo-guard-error.js', import.meta.url).href;

function fixture(context, configSource = 'export default [{ rules: { "no-debugger": "error" } }];\n') {
  const root = createGitProjectFixture(context, {
    'package.json': JSON.stringify({ name: 'exit-code-fixture', private: true, type: 'module' }),
    'repo-guard.config.json': stringifyProjectFixture({
      version: 2,
      project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
      checks: {
        eslint: { enabled: true, preset: false },
        prettier: { enabled: false }, stylelint: { enabled: false },
        maxFileLines: { enabled: false }, filePlacement: { enabled: false },
      },
      repository: { dependencyPolicy: { enabled: false }, rules: [{ pattern: '**', category: '测试文件', level: 'audit' }] },
      reporting: { notification: { enabled: false }, commitAnimation: { enabled: false } },
    }),
    'eslint.config.mjs': configSource,
    'sample.js': 'export const value = 1;\n',
  });
  fixtureGit(root, ['config', 'core.autocrlf', 'false']);
  for (const method of ['log', 'warn', 'error']) context.mock.method(console, method, () => {});
  return root;
}

test('真实 quality-files 与 lint-staged 对同一规则违规均返回2且恢复部分暂存', async (context) => {
  const root = fixture(context);
  const file = path.join(root, 'sample.js');
  const staged = 'debugger;\n';
  writeFileSync(file, staged);
  fixtureGit(root, ['add', 'sample.js']);
  assert.equal(await runQualityFileCommand([file], root), 2);
  const local = `${staged}// 未暂存的工作\n`;
  writeFileSync(file, local);
  assert.equal(await runQualityGate({ cwd: root }), 2);
  assert.equal(fixtureGit(root, ['show', ':sample.js']), staged.trim());
  assert.equal(readFileSync(file, 'utf8'), local);
  assert.equal(fixtureGit(root, ['stash', 'list']), '');
});

test('真实 lint-staged 保留范围错误3，不压缩为1或归为规则违规', async (context) => {
  const root = fixture(context, `import { rangeError } from ${JSON.stringify(ERRORS)};\nthrow rangeError('test/untrusted-range', '测试检查范围不可信');\n`);
  const file = path.join(root, 'sample.js');
  writeFileSync(file, 'export const value = 2;\n');
  fixtureGit(root, ['add', 'sample.js']);
  writeFileSync(file, 'export const value = 2;\n// 未暂存的内容\n');
  assert.equal(await runQualityGate({ cwd: root }), 3);
  assert.match(readFileSync(file, 'utf8'), /未暂存/);
  assert.equal(fixtureGit(root, ['show', ':sample.js']), 'export const value = 2;');
});

test('质量子进程异常退出但未返回结果时，CLI明确报告执行错误1', (context) => {
  const root = fixture(context, 'process.exit(17);\n');
  writeFileSync(path.join(root, 'sample.js'), 'export const value = 2;\n');
  fixtureGit(root, ['add', 'sample.js']);
  const result = spawnSync(process.execPath, [CLI, 'pre-commit'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /子任务未完整返回结果/);
  assert.equal(fixtureGit(root, ['show', ':sample.js']), 'export const value = 2;');
});

test('工具留下额外工作树变更时按恢复异常返回1并保留现场', (context) => {
  const root = fixture(context, 'import { writeFileSync } from "node:fs";\nwriteFileSync("unexpected.txt", "待检查的工具副作用");\nexport default [{ rules: { "no-debugger": "error" } }];\n');
  writeFileSync(path.join(root, 'sample.js'), 'debugger;\n');
  fixtureGit(root, ['add', 'sample.js']);
  const result = spawnSync(process.execPath, [CLI, 'pre-commit'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /未完整恢复/);
  assert.equal(readFileSync(path.join(root, 'unexpected.txt'), 'utf8'), '待检查的工具副作用');
});

test('子 CLI 未开始检查却返回0时拒绝空通道，无暂存文件仍正常跳过', async (context) => {
  const root = fixture(context);
  assert.equal(await runQualityGate({ cwd: root }), 0);
  writeFileSync(path.join(root, 'sample.js'), 'debugger;\n');
  fixtureGit(root, ['add', 'sample.js']);
  const original = process.env.NODE_OPTIONS;
  context.after(() => {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  });
  process.env.NODE_OPTIONS = `${original ?? ''} --import=data:text/javascript,process.exit(0)`.trim();
  await assert.rejects(runQualityGate({ cwd: root }), (error) => error.code === 'pre-commit/quality-result-missing');
});

test('仅删除文件时子 CLI 提前退出0仍须阻断，不能跳过质量检查', async (context) => {
  const root = fixture(context);
  fixtureGit(root, ['rm', 'sample.js']);
  assert.equal(await runQualityGate({ cwd: root }), 0);
  const original = process.env.NODE_OPTIONS;
  context.after(() => {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  });
  process.env.NODE_OPTIONS = `${original ?? ''} --import=data:text/javascript,process.exit(0)`.trim();
  await assert.rejects(runQualityGate({ cwd: root }), (error) => error.code === 'pre-commit/deletion-quality-result-invalid');
  assert.equal(fixtureGit(root, ['diff', '--cached', '--name-status']), 'D\tsample.js');
});

test('仅删除文件的真实违规保持2，子进程篡改退出码为0时拒绝不一致结果', async (context) => {
  const root = fixture(context);
  const configFile = path.join(root, 'repo-guard.config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.checks.pathNaming = { enabled: true, convention: 'camelCase', include: ['**/*.js'], exclude: [] };
  writeFileSync(configFile, JSON.stringify(config));
  writeFileSync(path.join(root, 'BadName.js'), 'export const value = 1;\n');
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 建立目录命名样例']);
  fixtureGit(root, ['rm', 'sample.js']);
  assert.equal(await runQualityGate({ cwd: root }), 2);
  const original = process.env.NODE_OPTIONS;
  context.after(() => {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  });
  const changeExitCode = encodeURIComponent('process.on("exit", () => { process.exitCode = 0; });');
  process.env.NODE_OPTIONS = `${original ?? ''} --import=data:text/javascript,${changeExitCode}`.trim();
  await assert.rejects(runQualityGate({ cwd: root }), (error) => error.code === 'pre-commit/deletion-quality-result-invalid');
  assert.equal(fixtureGit(root, ['diff', '--cached', '--name-status']), 'D\tsample.js');
});
