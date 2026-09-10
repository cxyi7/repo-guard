import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createGitProjectFixture, fixtureGit } from '../helpers/git-project.js';
import { runCiCommand } from '../../src/orchestration/ci/command.js';
import { runDeliveryCommand } from '../../src/orchestration/cli/delivery.js';
import {
  bindDelivery,
  createDeliveryKey,
  initializeDelivery,
  writeDeliveryJson,
} from '../../src/orchestration/delivery/storage.js';
import {
  loadDeliveryWorkspace,
  validateReceipt,
} from '../../src/policies/delivery-contract/collaboration.js';

function read(root, file) {
  return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
}

async function fixture(t, { enabled = true, mode = 'inherit', build = 'process.exit(0);\n' } = {}) {
  const root = createGitProjectFixture(t, {
    'src/value.txt': '待验证的实现\n',
    'build.cjs': build,
    'package.json': JSON.stringify({ name: 'delivery-ci-fixture', version: '1.0.0', scripts: { build: 'node build.cjs' } }),
  });
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeDeliveryJson(root, 'repo-guard.config.json', {
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
    checks: { eslint: { enabled: false }, prettier: { enabled: false }, build: { enabled } },
    repository: { dependencyPolicy: { enabled: false } },
    reporting: { notification: { enabled: false } },
    ci: { enabled: true, profile: 'full', gatePolicy: { defaultMode: 'off', gates: { 'quality.build': { mode } } } },
  });
  createDeliveryKey(root, 'reviewer');
  initializeDelivery(root, {
    id: 'delivery', participant: 'api', repository: 'api-repo', role: 'backend',
    reviewerPublicKey: '.repo-guard/reviewer.pub',
  });
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].checks = [{ id: 'build', kind: 'gate', gateId: 'quality.build' }];
  contract.participants[0].tasks[0].checks = ['build'];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'api');
  assert.equal(await runDeliveryCommand(['approve', '--key-file', '.repo-guard/local/reviewer.pem'], root), 0);
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 配置交付工程检查']);
  return { root, base, head: fixtureGit(root, ['rev-parse', 'HEAD']) };
}

function receipt(repo) {
  return validateReceipt(loadDeliveryWorkspace(repo.root), read(repo.root, 'reports/delivery/participants/api.json'));
}

test('CI 工程门禁实际通过后自动签署对应提交的交付证据', async (t) => {
  const repo = await fixture(t);
  assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
  const payload = receipt(repo);
  assert.equal(payload.subject.commit, repo.head);
  assert.equal(payload.subject.participant, 'api');
  assert.deepEqual(payload.checks.map(({ id, status }) => ({ id, status })), [{ id: 'build', status: 'passed' }]);
  const report = read(repo.root, 'reports/repo-guard.json');
  assert.equal(report.steps.find(({ gateResult }) => gateResult.gateId === 'quality.build').gateResult.status, 'passed');
});

test('关闭工程检查或关闭 CI 策略时，必需门禁不能生成通过证据', async (t) => {
  for (const options of [{ enabled: false }, { mode: 'off' }]) {
    const repo = await fixture(t, options);
    await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} });
    assert.deepEqual(receipt(repo).checks.map(({ id, status }) => ({ id, status })), [{ id: 'build', status: 'failed' }]);
    assert.equal(await runDeliveryCommand(['verify'], repo.root), 2);
  }
});

test('CI 指定的历史提交与当前代码不一致时拒绝签署新证据', async (t) => {
  const repo = await fixture(t);
  fixtureGit(repo.root, ['commit', '--allow-empty', '-m', 'test: 更新当前提交']);
  assert.notEqual(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
  assert.equal(read(repo.root, 'reports/repo-guard.json').gateResult.error.code, 'delivery/subject-changed');
  assert.equal(existsSync(path.join(repo.root, 'reports/delivery/participants/api.json')), false);
});

test('检查脚本执行期间修改 Git 提交时拒绝签署新证据', async (t) => {
  const repo = await fixture(t, {
    build: 'require("node:child_process").execFileSync("git", ["commit", "--allow-empty", "-m", "test: 检查期间更换提交"], { stdio: "pipe", windowsHide: true });\n',
  });
  assert.notEqual(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
  assert.notEqual(fixtureGit(repo.root, ['rev-parse', 'HEAD']), repo.head);
  assert.equal(read(repo.root, 'reports/repo-guard.json').gateResult.error.code, 'delivery/subject-changed');
  assert.equal(existsSync(path.join(repo.root, 'reports/delivery/participants/api.json')), false);
});

async function accept(repo) {
  assert.equal(await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收负责人'], repo.root), 0);
}

test('已验收的单应用发布复核保留通过证据，退出码与最终验收状态一致', async (t) => {
  const repo = await fixture(t, { build: 'console.log(require("node:crypto").randomUUID());\n' });
  const options = { base: repo.base, head: repo.head, env: {} };
  assert.equal(await runCiCommand(repo.root, options), 0);
  await accept(repo);
  const approvedReceipt = readFileSync(path.join(repo.root, 'reports/delivery/participants/api.json'), 'utf8');
  assert.equal(await runCiCommand(repo.root, { ...options, profile: 'release-ready' }), 0);
  assert.equal(await runDeliveryCommand(['verify'], repo.root), 0);
  assert.equal(readFileSync(path.join(repo.root, 'reports/delivery/participants/api.json'), 'utf8'), approvedReceipt);
});

test('发布复核的必需检查失败立即撤销通过证据，即使工程策略仅报告也不能沿用旧验收', async (t) => {
  const repo = await fixture(t, { mode: 'report', build: 'process.exit(require("node:fs").existsSync(".repo-guard/local/build-fails") ? 1 : 0);\n' });
  const options = { base: repo.base, head: repo.head, env: {} };
  assert.equal(await runCiCommand(repo.root, options), 0);
  await accept(repo);
  writeFileSync(path.join(repo.root, '.repo-guard/local/build-fails'), '模拟外部构建条件失败');
  assert.notEqual(await runCiCommand(repo.root, { ...options, profile: 'release-ready' }), 0);
  assert.equal(receipt(repo).checks[0].status, 'failed');
  assert.equal(await runDeliveryCommand(['verify'], repo.root), 2);
  const report = read(repo.root, 'reports/repo-guard.json');
  assert.equal(report.steps.find(({ gateResult }) => gateResult.gateId === 'release.delivery-evidence').gateResult.status, 'violation');
});

test('已经验收后关闭检查或关闭其 CI 策略，发布复核与交付验收都不能通过', async (t) => {
  for (const setting of ['disabled', 'off']) {
    const repo = await fixture(t);
    assert.equal(await runCiCommand(repo.root, { base: repo.base, head: repo.head, env: {} }), 0);
    await accept(repo);
    const config = read(repo.root, 'repo-guard.config.json');
    if (setting === 'disabled') config.checks.build.enabled = false;
    else config.ci.gatePolicy.gates['quality.build'].mode = 'off';
    writeDeliveryJson(repo.root, 'repo-guard.config.json', config);
    fixtureGit(repo.root, ['add', 'repo-guard.config.json']);
    fixtureGit(repo.root, ['commit', '-m', 'test: 关闭已验收的必需检查']);
    repo.head = fixtureGit(repo.root, ['rev-parse', 'HEAD']);
    assert.notEqual(await runCiCommand(repo.root, { base: repo.base, head: repo.head, profile: 'release-ready', env: {} }), 0);
    assert.equal(receipt(repo).checks[0].status, 'failed');
    assert.equal(await runDeliveryCommand(['verify'], repo.root), 2);
  }
});

async function workspaceFixture(t) {
  const files = { '.gitignore': '**/reports/\n' };
  for (const id of ['web', 'api']) {
    files[`apps/${id}/package.json`] = JSON.stringify({ name: id, version: '1.0.0', scripts: { build: 'node build.cjs' } });
    files[`apps/${id}/build.cjs`] = 'console.log(require("node:crypto").randomUUID());\n';
  }
  const root = createGitProjectFixture(t, files);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeDeliveryJson(root, 'repo-guard.config.json', { version: 2, projects: ['web', 'api'].map((id) => ({ id, root: `apps/${id}` })),
    reporting: { notification: { enabled: false } }, ci: { enabled: true, profile: 'full', gatePolicy: { defaultMode: 'off' } } });
  for (const id of ['web', 'api']) writeDeliveryJson(root, `apps/${id}/repo-guard.config.json`, {
    version: 2, project: { id, role: id === 'web' ? 'frontend' : 'backend', stack: 'node', preset: id === 'web' ? 'vue-javascript' : 'node-javascript' },
    checks: { eslint: { enabled: false }, prettier: { enabled: false }, build: { enabled: true } },
    repository: { dependencyPolicy: { enabled: false } }, ci: { gatePolicy: { defaultMode: 'off', gates: { 'quality.build': { mode: 'inherit' } } } },
  });
  createDeliveryKey(root, 'reviewer');
  initializeDelivery(root, { id: 'delivery', participant: 'web', repository: 'workspace', role: 'frontend', reviewerPublicKey: '.repo-guard/reviewer.pub' });
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].root = 'apps/web';
  contract.participants[0].checks = [{ id: 'build', kind: 'gate', gateId: 'quality.build' }];
  contract.participants[0].tasks[0].checks = ['build'];
  contract.participants.push({ ...structuredClone(contract.participants[0]), id: 'api', role: 'backend', root: 'apps/api' });
  contract.integration.checks = [{ id: 'joint', kind: 'command', participants: ['web', 'api'], command: process.execPath,
    args: ['-e', 'const b=JSON.parse(process.env.REPO_GUARD_DELIVERY_BASELINE);require("fs").writeFileSync(process.env.REPO_GUARD_DELIVERY_REPORT,JSON.stringify({version:2,status:"passed",subjects:b.subjects,baselineDigest:process.env.REPO_GUARD_DELIVERY_BASELINE_DIGEST}));'], timeoutMs: 5000 }];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'web,api');
  await runDeliveryCommand(['approve', '--key-file', '.repo-guard/local/reviewer.pem'], root);
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 配置前后端联合交付']);
  return { root, base, head: fixtureGit(root, ['rev-parse', 'HEAD']) };
}

test('多应用发布复核不刷新已验收的参与方证据，联合验收可以持续通过', async (t) => {
  const repo = await workspaceFixture(t);
  const options = { base: repo.base, head: repo.head, env: {} };
  assert.equal(await runCiCommand(repo.root, options), 0);
  assert.equal(await runDeliveryCommand(['integrate', '--check', 'joint', '--key-file', '.repo-guard/local/runner.pem'], repo.root), 0);
  await accept(repo);
  const original = ['web', 'api'].map((id) => readFileSync(path.join(repo.root, `reports/delivery/participants/${id}.json`), 'utf8'));
  assert.equal(await runCiCommand(repo.root, { ...options, profile: 'release-ready' }), 0);
  assert.equal(await runDeliveryCommand(['verify'], repo.root), 0);
  assert.deepEqual(['web', 'api'].map((id) => readFileSync(path.join(repo.root, `reports/delivery/participants/${id}.json`), 'utf8')), original);
});
