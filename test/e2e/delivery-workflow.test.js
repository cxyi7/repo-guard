import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createGitProjectFixture, fixtureGit } from '../helpers/git-project.js';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { createDeliveryKey, initializeDelivery, bindDelivery, writeDeliveryJson } from '../../src/orchestration/delivery/storage.js';
import { runDeliveryCommand } from '../../src/orchestration/cli/delivery.js';
import { loadDeliveryWorkspace, contractDefinition, signDelivery } from '../../src/policies/delivery-contract/collaboration.js';
import { inspectCollaborativeDelivery } from '../../src/policies/delivery-contract/collaboration.js';

function read(root, file) { return JSON.parse(readFileSync(path.join(root, file), 'utf8')); }
function commit(root, message = 'test: 记录交付配置') {
  fixtureGit(root, ['add', '.']);
  return fixtureGit(root, ['commit', '--allow-empty', '-m', message]);
}
function fixture(t, id = 'web') {
  const root = createGitProjectFixture(t, { 'src/value.txt': '初始实现\n' });
  createDeliveryKey(root, 'reviewer');
  initializeDelivery(root, { id: 'delivery', participant: id, repository: `${id}-repo`, role: id === 'web' ? 'frontend' : 'backend', reviewerPublicKey: '.repo-guard/reviewer.pub' });
  return root;
}
async function approve(root) {
  assert.equal(await runDeliveryCommand(['approve', '--key-file', '.repo-guard/local/reviewer.pem'], root), 0);
  commit(root);
}

test('无 package.json 的仓库可独立执行合同，草案和未完成检查不能冒充验收', async (t) => {
  const root = fixture(t, 'java');
  assert.equal(existsSync(path.join(root, 'package.json')), false);
  const workspace = loadWorkspace(root);
  assert.equal(workspace.deliveryOnly, true);
  assert.equal(workspace.projects.length, 0);
  assert.equal(Object.values(workspace.repositoryConfig.checks).some(({ enabled }) => enabled), false);
  await assert.rejects(runDeliveryCommand(['check'], root), { code: 'delivery/approval-required' });
  await approve(root);
  assert.equal(await runDeliveryCommand(['check'], root), 0);
  assert.equal(await runDeliveryCommand(['verify'], root), 2);
  assert.equal(await runDeliveryCommand(['run', '--check', 'diff-check'], root), 0);
  assert.equal(await runDeliveryCommand(['verify'], root), 2);
  await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收负责人'], root);
  assert.equal(await runDeliveryCommand(['verify'], root), 0);
  commit(root, 'test: 新版本必须重新验证');
  assert.equal(await runDeliveryCommand(['verify'], root), 2);
});

test('交付与 Node 工程配置同时开启，已关闭的必需门禁不能成为通过证据', async (t) => {
  const root = fixture(t, 'api');
  writeDeliveryJson(root, 'repo-guard.config.json', { version: 2, project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
    checks: { eslint: { enabled: false } } });
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].checks = [{ id: 'diff-check', kind: 'gate', gateId: 'quality.eslint' }];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'api');
  await approve(root);
  assert.equal(loadWorkspace(root).projects.length, 1);
  assert.equal(await runDeliveryCommand(['run', '--check', 'diff-check'], root), 2);
  assert.equal(await runDeliveryCommand(['verify'], root), 2);
  assert.equal(await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收人'], root), 2);
});

test('分仓前后端共享合同，交换可信证据，任一版本更新使联合验收失效', async (t) => {
  const web = fixture(t, 'web');
  const api = fixture(t, 'python');
  const contract = read(web, 'docs/delivery/delivery.json');
  contract.participants.push(read(api, 'docs/delivery/delivery.json').participants[0]);
  contract.integration.checks = [{ id: 'joint-test', kind: 'command', participants: ['web', 'python'], command: process.execPath,
    args: ['-e', 'const b=JSON.parse(process.env.REPO_GUARD_DELIVERY_BASELINE);if(b.subjects.length!==2)process.exit(1);require("fs").writeFileSync(process.env.REPO_GUARD_DELIVERY_REPORT,JSON.stringify({version:2,status:"passed",subjects:b.subjects,baselineDigest:process.env.REPO_GUARD_DELIVERY_BASELINE_DIGEST}));'], timeoutMs: 5000 }];
  contract.approval = signDelivery(contractDefinition(contract), readFileSync(path.join(web, '.repo-guard/local/reviewer.pem'), 'utf8'));
  for (const [root, participant] of [[web, 'web'], [api, 'python']]) {
    writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
    bindDelivery(root, 'docs/delivery/delivery.json', participant);
    commit(root);
    assert.equal(await runDeliveryCommand(['run', '--check', 'diff-check'], root), 0);
  }
  const source = path.join(api, 'reports/delivery/participants/python.json');
  await runDeliveryCommand(['import', '--from', source], web);
  assert.equal(await runDeliveryCommand(['verify'], web), 2);
  assert.equal(await runDeliveryCommand(['integrate', '--check', 'joint-test', '--key-file', '.repo-guard/local/runner.pem'], web), 0);
  await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '交付负责人'], web);
  assert.equal(await runDeliveryCommand(['verify'], web), 0);
  const original = readFileSync(source, 'utf8');
  const forged = JSON.parse(original);
  forged.payload.subject.commit = 'a'.repeat(40);
  writeFileSync(source, JSON.stringify(forged));
  await assert.rejects(runDeliveryCommand(['import', '--from', source], web), { code: 'delivery/receipt-untrusted' });
  writeFileSync(source, original);
  commit(api, 'test: 后端升级');
  await runDeliveryCommand(['run', '--check', 'diff-check'], api);
  await runDeliveryCommand(['import', '--from', source], web);
  assert.equal(await runDeliveryCommand(['verify'], web), 2);
});

test('修改合同必须重新绑定且重新人工确认，普通执行密钥不能代替验收密钥', async (t) => {
  const root = fixture(t);
  await approve(root);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.revision += 1;
  contract.title = '修订后的需求';
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  assert.throws(() => loadDeliveryWorkspace(root), { code: 'delivery/contract-drift' });
  bindDelivery(root, 'docs/delivery/delivery.json', 'web');
  await assert.rejects(runDeliveryCommand(['check'], root), { code: 'delivery/approval-required' });
  await assert.rejects(runDeliveryCommand(['approve', '--key-file', '.repo-guard/local/runner.pem'], root), { code: 'delivery/wrong-signing-key' });
});

test('提交只读取暂存合同，不能用未暂存的确认覆盖失效的暂存定义', async (t) => {
  const root = fixture(t);
  await approve(root);
  const original = read(root, 'docs/delivery/delivery.json');
  writeDeliveryJson(root, 'docs/delivery/delivery.json', { ...original, title: '未暂存改动' });
  assert.equal(inspectCollaborativeDelivery(root, { source: 'pre-commit' }).status, 'passed');
  fixtureGit(root, ['add', 'docs/delivery/delivery.json']);
  writeDeliveryJson(root, 'docs/delivery/delivery.json', original);
  assert.throws(() => inspectCollaborativeDelivery(root, { source: 'pre-commit' }), { code: 'delivery/contract-drift' });
});

test('同仓多个应用分别产生证据，命令必须明确选择参与方', async (t) => {
  const root = fixture(t);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].root = 'src';
  contract.participants.push({ ...structuredClone(contract.participants[0]), id: 'api', role: 'backend', root: 'server' });
  contract.integration.checks = [{ id: 'joint', kind: 'command', participants: ['web', 'api'], command: 'git', args: ['diff', '--check'], timeoutMs: 5000 }];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  writeDeliveryJson(root, 'server/placeholder.json', {});
  bindDelivery(root, 'docs/delivery/delivery.json', 'web,api');
  await approve(root);
  await assert.rejects(runDeliveryCommand(['run', '--check', 'diff-check'], root), { code: 'delivery/option-required' });
  for (const participant of ['web', 'api']) assert.equal(await runDeliveryCommand(['run', '--participant', participant, '--check', 'diff-check'], root), 0);
  assert.equal(read(root, 'reports/delivery/participants/web.json').payload.subject.commit, read(root, 'reports/delivery/participants/api.json').payload.subject.commit);
  assert.equal(await runDeliveryCommand(['verify'], root), 2);
});

test('真实反馈保留同一测试的失败与通过证据，绑定反向改进后重新验收', async (t) => {
  const root = fixture(t, 'api');
  const contract = read(root, 'docs/delivery/delivery.json');
  writeFileSync(path.join(root, 'regression.cjs'), 'const fs=require("fs");process.exit(fs.readFileSync("src/value.txt","utf8").includes("修复")?0:1);\n');
  contract.participants[0].checks = [{ id: 'regression', kind: 'command', command: process.execPath, args: ['regression.cjs'], testFiles: ['regression.cjs'], timeoutMs: 5000 }];
  contract.participants[0].tasks[0].checks = ['regression'];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'api');
  await approve(root);
  assert.equal(await runDeliveryCommand(['run', '--check', 'regression'], root), 2);
  await runDeliveryCommand(['feedback', '--id', 'bug', '--requirement', 'requirement', '--description', '真实复测发现实现缺陷', '--check', 'regression', '--improvement', '保留本回归测试防止重复出现', '--improvement-check', 'regression'], root);
  await approve(root);
  writeFileSync(path.join(root, 'src/value.txt'), '已经修复\n');
  commit(root);
  assert.equal(await runDeliveryCommand(['run', '--check', 'regression'], root), 0);
  assert.equal(await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '复测负责人'], root), 0);
  assert.equal(await runDeliveryCommand(['verify'], root), 0);
});

test('合同目录采用等价相对路径时仍约束本方文件，同时放行其他参与方和公共资料', async (t) => {
  const roots = ['./src', 'src/.', ...(process.platform === 'win32' ? ['SRC'] : [])];
  for (const participantRoot of roots) {
    const root = fixture(t);
    const contract = read(root, 'docs/delivery/delivery.json');
    contract.participants[0].root = participantRoot;
    contract.participants[0].tasks[0].allowedPaths = ['allowed/**'];
    writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
    bindDelivery(root, 'docs/delivery/delivery.json', 'web');
    await approve(root);
    assert.equal(inspectCollaborativeDelivery(root, { changes: [
      { path: 'src/allowed/value.js' }, { path: 'server/value.js' }, { path: 'docs/design.md' },
    ] }).status, 'passed');
    assert.throws(() => inspectCollaborativeDelivery(root, { changes: [{ path: 'src/forbidden.js' }] }), { code: 'delivery/change-outside' });
  }
});

test('已提交重命名必须检查源路径，不能通过移入允许目录绕过合同边界', async (t) => {
  const root = fixture(t);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].tasks[0].allowedPaths = ['allowed/**', 'docs/**', '.agents/**', '.repo-guard/**', 'repo-guard.delivery.json', '.gitignore'];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'web');
  await approve(root);
  mkdirSync(path.join(root, 'allowed'));
  renameSync(path.join(root, 'src/value.txt'), path.join(root, 'allowed/value.txt'));
  commit(root);
  await assert.rejects(runDeliveryCommand(['check'], root), { code: 'delivery/change-outside' });
});

test('通过证据不能覆盖未提交、暂存或未跟踪代码，验收必须等待当前变更完成验证', async (t) => {
  for (const state of ['unstaged', 'staged', 'untracked']) {
    const root = fixture(t);
    await approve(root);
    await runDeliveryCommand(['run', '--check', 'diff-check'], root);
    await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收人'], root);
    writeFileSync(path.join(root, state === 'untracked' ? 'src/new.txt' : 'src/value.txt'), '尚未验证的变更\n');
    if (state === 'staged') fixtureGit(root, ['add', 'src/value.txt']);
    assert.equal(await runDeliveryCommand(['verify'], root), 2);
    assert.equal(inspectCollaborativeDelivery(root, { evidence: true }).status, 'pending');
    assert.equal(await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收人'], root), 2);
  }
});

test('联合验证修改工作区后不能签署通过证据', async (t) => {
  const root = fixture(t);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.integration.checks = [{ id: 'joint', kind: 'command', participants: ['web'], command: process.execPath,
    args: ['-e', 'const fs=require("fs"),b=JSON.parse(process.env.REPO_GUARD_DELIVERY_BASELINE);fs.writeFileSync("src/value.txt","未经提交的变更");fs.writeFileSync(process.env.REPO_GUARD_DELIVERY_REPORT,JSON.stringify({version:2,status:"passed",subjects:b.subjects,baselineDigest:process.env.REPO_GUARD_DELIVERY_BASELINE_DIGEST}));'], timeoutMs: 5000 }];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'web');
  await approve(root);
  await runDeliveryCommand(['run', '--check', 'diff-check'], root);
  await assert.rejects(runDeliveryCommand(['integrate', '--check', 'joint', '--key-file', '.repo-guard/local/runner.pem'], root), { code: 'delivery/uncommitted-subject' });
  assert.equal(existsSync(path.join(root, 'reports/delivery/integration/joint.json')), false);
  assert.equal(await runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收人'], root), 2);
});

test('联合验证未报告代码组合时按失败处理，不产生内部异常或通过证据', async (t) => {
  const root = fixture(t);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.integration.checks = [{ id: 'joint', kind: 'command', participants: ['web'], command: process.execPath,
    args: ['-e', 'require("fs").writeFileSync(process.env.REPO_GUARD_DELIVERY_REPORT,JSON.stringify({version:2,status:"passed",baselineDigest:process.env.REPO_GUARD_DELIVERY_BASELINE_DIGEST}));'], timeoutMs: 5000 }];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'web');
  await approve(root);
  await runDeliveryCommand(['run', '--check', 'diff-check'], root);
  assert.equal(await runDeliveryCommand(['integrate', '--check', 'joint', '--key-file', '.repo-guard/local/runner.pem'], root), 1);
  assert.equal(read(root, 'reports/delivery/integration/joint.json').payload.status, 'failed');
});

test('损坏或空值证据提供明确配置错误，不能抛出内部类型异常', async (t) => {
  const root = fixture(t);
  await approve(root);
  await runDeliveryCommand(['run', '--check', 'diff-check'], root);
  const file = 'reports/delivery/participants/web.json';
  const envelope = read(root, file);
  envelope.payload.checks = [null];
  envelope.signature = signDelivery(envelope.payload, readFileSync(path.join(root, '.repo-guard/local/runner.pem'), 'utf8'));
  writeDeliveryJson(root, file, envelope);
  await assert.rejects(runDeliveryCommand(['verify'], root), { code: 'delivery/checks-invalid' });
  writeDeliveryJson(root, file, null);
  await assert.rejects(runDeliveryCommand(['verify'], root), { code: 'delivery/receipt-untrusted' });
});

test('关闭未确认的合同后跳过约束，但不能运行检查或生成验收', async (t) => {
  const root = fixture(t);
  await runDeliveryCommand(['disable'], root);
  assert.equal(inspectCollaborativeDelivery(root).status, 'skipped');
  await assert.rejects(runDeliveryCommand(['run', '--check', 'diff-check'], root), { code: 'delivery/disabled' });
  await assert.rejects(runDeliveryCommand(['accept', '--key-file', '.repo-guard/local/reviewer.pem', '--by', '验收人'], root), { code: 'delivery/disabled' });
});

test('同仓绑定不能遗漏合同参与方，拒绝后保留原绑定和托管规范', async (t) => {
  const root = fixture(t);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].root = 'src';
  contract.participants.push({ ...structuredClone(contract.participants[0]), id: 'api', role: 'backend', root: 'server' });
  contract.integration.checks = [{ id: 'joint', kind: 'command', participants: ['web', 'api'], command: 'git', args: ['diff', '--check'], timeoutMs: 5000 }];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'web,api');
  const originalBinding = readFileSync(path.join(root, 'repo-guard.delivery.json'), 'utf8');
  const originalSkills = readFileSync(path.join(root, '.repo-guard/managed-skills.json'), 'utf8');
  assert.throws(() => bindDelivery(root, 'docs/delivery/delivery.json', 'web'), { code: 'delivery/incomplete-local-participants' });
  assert.equal(readFileSync(path.join(root, 'repo-guard.delivery.json'), 'utf8'), originalBinding);
  assert.equal(readFileSync(path.join(root, '.repo-guard/managed-skills.json'), 'utf8'), originalSkills);
  writeDeliveryJson(root, 'repo-guard.delivery.json', { ...JSON.parse(originalBinding), participants: ['web'] });
  assert.throws(() => loadDeliveryWorkspace(root, { requireApproval: false }), { code: 'delivery/incomplete-local-participants' });
});

test('首次暂存的交付配置即使从工作区删除也不能绕过暂存合同约束', async (t) => {
  const root = fixture(t);
  const contract = read(root, 'docs/delivery/delivery.json');
  contract.participants[0].root = 'src';
  contract.participants[0].tasks[0].allowedPaths = ['allowed/**'];
  writeDeliveryJson(root, 'docs/delivery/delivery.json', contract);
  bindDelivery(root, 'docs/delivery/delivery.json', 'web');
  await runDeliveryCommand(['approve', '--key-file', '.repo-guard/local/reviewer.pem'], root);
  fixtureGit(root, ['add', '.']);
  unlinkSync(path.join(root, 'repo-guard.delivery.json'));
  assert.throws(() => inspectCollaborativeDelivery(root, { source: 'pre-commit', changes: [{ path: 'src/forbidden.js' }] }), { code: 'delivery/change-outside' });
});
