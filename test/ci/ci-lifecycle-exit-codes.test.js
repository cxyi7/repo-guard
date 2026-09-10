import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createGitProjectFixture, fixtureGit } from '../helpers/git-project.js';

const RUNNER_URL = new URL('../../src/orchestration/ci/runner.js', import.meta.url).href;
const CONFIG_URL = new URL('../../src/config/project-configuration.js', import.meta.url).href;
const PROGRAM = `
import { runCiGate } from ${JSON.stringify(RUNNER_URL)};
import { normalizeProjectDocument } from ${JSON.stringify(CONFIG_URL)};
const config = normalizeProjectDocument({ version: 2,
  project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
  ci: { enabled: true, reportPath: 'reports/repo-guard-ci.json' } });
process.exitCode = await runCiGate({ root: process.cwd(), config,
  base: process.env.REPO_GUARD_TEST_BASE, head: process.env.REPO_GUARD_TEST_HEAD, env: {} });
`;

function execute(root, { base, head, missingGit = false }) {
  // PATH 仅在测试子进程中移除，不影响并行检查或用户当前环境。
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !missingGit || key.toLowerCase() !== 'path'));
  if (missingGit) env.PATH = '';
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', PROGRAM], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...env, REPO_GUARD_TEST_BASE: base, REPO_GUARD_TEST_HEAD: head },
  });
  assert.equal(result.error, undefined, result.error?.message);
  const reportFile = path.join(root, 'reports/repo-guard-ci.json');
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  return { result, report };
}

test('采集范围时 Git 无法启动保留执行错误，无法核对安全写入条件时不写报告', (t) => {
  const root = createGitProjectFixture(t, { 'src/value.js': 'export const ready = true;\n' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  const { result, report } = execute(root, { base: head, head, missingGit: true });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(report, null);
  assert.match(result.stderr, /执行错误/);
  assert.match(result.stderr, /git\/process-start-failed/);
  assert.doesNotMatch(result.stderr, /TypeError|不匹配/);
});

test('Git 采集命令执行失败保留执行错误和报告，不能改写成范围错误', (t) => {
  const root = createGitProjectFixture(t, { 'src/value.js': 'export const ready = true;\n' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  fixtureGit(root, ['config', 'diff.renameLimit', 'invalid']);
  const { result, report } = execute(root, { base: head, head });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(report, result.stderr);
  assert.equal(report.status, 'execution-error');
  assert.equal(report.gateResult.status, 'execution-error');
  assert.equal(report.gateResult.error.kind, 'execution');
  assert.equal(report.gateResult.error.code, 'git/command-failed');
  assert.match(result.stderr, /git\/command-failed/);
  assert.doesNotMatch(result.stderr, /TypeError|不匹配/);
});

test('Git 可用但提交范围无法解析仍返回范围错误并写入原范围诊断', (t) => {
  const root = createGitProjectFixture(t, { 'src/value.js': 'export const ready = true;\n' });
  const head = fixtureGit(root, ['rev-parse', 'HEAD']);
  const { result, report } = execute(root, { base: 'missing-test-revision', head });
  assert.equal(result.status, 3, result.stderr);
  assert.ok(report, result.stderr);
  assert.equal(report.status, 'range-error');
  assert.equal(report.gateResult.status, 'range-error');
  assert.equal(report.gateResult.error.kind, 'range');
  assert.equal(report.gateResult.error.code, 'ci-range/base-revision-unavailable');
  assert.match(result.stderr, /ci-range\/base-revision-unavailable/);
});
