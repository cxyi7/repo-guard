import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';
import { createDeliveryKey, initializeDelivery, bindDelivery, writeDeliveryJson } from '../../src/orchestration/delivery/storage.js';
import { runDeliveryCommand } from '../../src/orchestration/cli/delivery.js';

const CLI = fileURLToPath(new URL('../../bin/repo-guard.js', import.meta.url));
const KEY_OPTIONS = ['--key-file', '.repo-guard/local/runner.pem'];

function read(root, file) { return JSON.parse(readFileSync(path.join(root, file), 'utf8')); }
function cli(root, args) {
  const result = spawnSync(process.execPath, [CLI, 'delivery', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function command(id, source, timeoutMs = 5000) {
  return { id, kind: 'command', command: process.execPath, args: ['-e', source], timeoutMs };
}
async function fixture(t, { checks, integration = [], files = {}, config = null } = {}) {
  const root = createGitProjectFixture(t, { 'src/value.txt': '初始实现\n', ...files });
  createDeliveryKey(root, 'reviewer');
  initializeDelivery(root, { id: 'delivery', participant: 'app', repository: 'app-repo', role: 'backend',
    reviewerPublicKey: '.repo-guard/reviewer.pub' });
  if (config) writeDeliveryJson(root, 'repo-guard.config.json', config);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].checks = checks;
  contract.participants[0].tasks[0].checks = checks.map(({ id }) => id);
  contract.integration.checks = integration.map((check) => ({ ...check, participants: ['app'] }));
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'app');
  await runDeliveryCommand(['approve', '--key-file', '.repo-guard/local/reviewer.pem'], root);
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 确认退出码样例合同']);
  return root;
}
function receiptStatus(root, checkId) {
  return read(root, 'reports/delivery/participants/app.json').payload.checks.find(({ id }) => id === checkId)?.status;
}

test('真实交付命令将第三方正常非零退出归为违规，不透传外部退出码', async (t) => {
  const checks = [command('passed', 'process.exit(0)'), ...[1, 3, 7].map((code) => command(`failed-${code}`, `process.exit(${code})`))];
  const root = await fixture(t, { checks });
  for (const check of checks) {
    const passed = check.id === 'passed';
    const output = cli(root, ['run', '--check', check.id]);
    assert.equal(output.status, passed ? 0 : 2, output.stderr);
    assert.equal(receiptStatus(root, check.id), passed ? 'passed' : 'failed');
    assert.match(output.stdout, /第三方原始诊断：退出码/);
  }
  assert.equal(cli(root, ['status']).status, 0);
  assert.equal(cli(root, ['verify']).status, 2);
  const acceptance = cli(root, ['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收人']);
  assert.equal(acceptance.status, 2, acceptance.stderr);
  assert.match(acceptance.stderr, /delivery\/not-ready-for-acceptance/);
  assert.equal(existsSync(path.join(root, 'reports/delivery/acceptance.json')), false);
});

test('命令启动失败和超时返回执行错误，并留下失败证据', async (t) => {
  const root = await fixture(t, { checks: [
    { id: 'missing', kind: 'command', command: 'repo-guard-nonexistent-test-command', args: [], timeoutMs: 1000 },
    command('timeout', 'setTimeout(() => process.exit(0), 1800)', 1000),
  ] });
  for (const checkId of ['missing', 'timeout']) {
    const result = cli(root, ['run', '--check', checkId]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /delivery\/command-execution-failed/);
    assert.equal(receiptStatus(root, checkId), 'failed');
  }
});

test('信号中断不能作为普通断言失败', { skip: process.platform === 'win32' ? 'Windows 不提供等价的 POSIX 自终止信号结果；统一进程分类另有跨平台单测。' : false }, async (t) => {
  const root = await fixture(t, { checks: [command('signal', 'process.kill(process.pid, "SIGTERM")')] });
  assert.equal(cli(root, ['run', '--check', 'signal']).status, 1);
  assert.equal(receiptStatus(root, 'signal'), 'failed');
});

test('交付保留真实工程门禁的配置错误和违规分类，必需门禁跳过仍阻断', async (t) => {
  const cases = [
    { name: 'missing-script', gateId: 'quality.build', checks: { build: { enabled: true } }, scripts: {}, expected: 1, diagnostic: /build\/missing-script/ },
    { name: 'build-failed', gateId: 'quality.build', checks: { build: { enabled: true } }, scripts: { build: 'node -e "process.exit(7)"' }, expected: 2 },
    { name: 'build-timeout', gateId: 'quality.build', checks: { build: { enabled: true, timeoutMs: 1000 } }, scripts: { build: 'node -e "setTimeout(() => process.exit(0), 1800)"' }, expected: 1, diagnostic: /build\/timeout|orchestration\/gate-timeout/ },
    { name: 'disabled-eslint', gateId: 'quality.eslint', checks: { eslint: { enabled: false } }, scripts: {}, expected: 2, diagnostic: /被跳过/ },
  ];
  for (const item of cases) {
    const root = await fixture(t, { checks: [{ id: item.name, kind: 'gate', gateId: item.gateId }],
      files: { 'package.json': JSON.stringify({ scripts: item.scripts }) },
      config: { version: 2, project: { id: 'app', role: 'backend', stack: 'node', preset: 'node-javascript' }, checks: item.checks } });
    const output = cli(root, ['run', '--check', item.name]);
    assert.equal(output.status, item.expected, `${item.name}: ${output.stderr}`);
    if (item.diagnostic) assert.match(output.stderr, item.diagnostic);
    assert.equal(receiptStatus(root, item.name), 'failed');
  }
});

test('工程门禁的 Git 范围错误经交付 CLI 仍返回范围错误', async (t) => {
  const root = await fixture(t, {
    checks: [{ id: 'images', kind: 'gate', gateId: 'repository.unused-image-assets' }],
    files: { 'package.json': '{}', 'src/assets/unused.svg': '<svg xmlns="http://www.w3.org/2000/svg" />' },
    config: { version: 2, project: { id: 'app', role: 'frontend', stack: 'node', preset: 'vue-javascript' },
      checks: { imageAssets: { enabled: true, enforcement: 'changedFiles' }, unusedImageAssets: { enabled: true } } },
  });
  const output = cli(root, ['run', '--check', 'images']);
  assert.equal(output.status, 3, output.stderr);
  assert.match(output.stderr, /unused-image-assets\/revision-required/);
  assert.equal(receiptStatus(root, 'images'), 'failed');
});

test('联合验证前置证据未满足返回违规，成功命令缺少合法报告返回执行错误', async (t) => {
  const root = await fixture(t, { checks: [command('local', 'process.exit(0)')], integration: [command('joint', 'process.exit(0)')] });
  const pending = cli(root, ['integrate', '--check', 'joint', ...KEY_OPTIONS]);
  assert.equal(pending.status, 2, pending.stderr);
  assert.match(pending.stderr, /delivery\/participants-pending/);
  assert.equal(cli(root, ['run', '--check', 'local']).status, 0);
  const missingReport = cli(root, ['integrate', '--check', 'joint', ...KEY_OPTIONS]);
  assert.equal(missingReport.status, 1, missingReport.stderr);
  assert.match(missingReport.stderr, /delivery\/integration-report-invalid/);
  assert.equal(read(root, 'reports/delivery/integration/joint.json').payload.status, 'failed');
});

test('联合验证覆盖旧成功证据，并区分协议异常、版本不匹配和命令断言失败', async (t) => {
  const root = await fixture(t, { checks: [command('local', 'process.exit(0)')],
    integration: [{ id: 'joint', kind: 'command', command: process.execPath, args: ['joint.cjs'], timeoutMs: 5000 }],
    files: { 'joint.cjs': `const fs = require('fs');
const mode = fs.existsSync('.repo-guard/local/mode') ? fs.readFileSync('.repo-guard/local/mode', 'utf8') : 'passed';
if (mode === 'assertion') process.exit(7);
if (mode === 'missing') process.exit(0);
const baseline = JSON.parse(process.env.REPO_GUARD_DELIVERY_BASELINE);
const report = { version: 2, status: 'passed', subjects: baseline.subjects, baselineDigest: process.env.REPO_GUARD_DELIVERY_BASELINE_DIGEST };
if (mode === 'malformed') delete report.subjects;
if (mode === 'version') report.subjects = baseline.subjects.map(subject => ({ ...subject, commit: 'a'.repeat(40) }));
if (mode === 'baseline') report.baselineDigest = 'a'.repeat(64);
if (mode === 'failed') report.status = 'failed';
fs.writeFileSync(process.env.REPO_GUARD_DELIVERY_REPORT, JSON.stringify(report));
` } });
  assert.equal(cli(root, ['run', '--check', 'local']).status, 0);
  for (const [mode, expected] of [['missing', 1], ['malformed', 1], ['version', 2], ['baseline', 2], ['failed', 2], ['assertion', 2]]) {
    writeProjectFile(root, '.repo-guard/local/mode', 'passed');
    assert.equal(cli(root, ['integrate', '--check', 'joint', ...KEY_OPTIONS]).status, 0);
    writeProjectFile(root, '.repo-guard/local/mode', mode);
    const output = cli(root, ['integrate', '--check', 'joint', ...KEY_OPTIONS]);
    assert.equal(output.status, expected, `${mode}: ${output.stderr}`);
    assert.equal(read(root, 'reports/delivery/integration/joint.json').payload.status, 'failed');
    assert.equal(cli(root, ['verify']).status, 2);
  }
});
