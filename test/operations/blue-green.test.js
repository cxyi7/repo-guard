import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateOperationsConfig } from '../../src/operations/config/validation.js';
import { validateBlueGreen } from '../../src/operations/config/blue-green.js';
import { executeBlueGreen } from '../../src/operations/deployment/engine.js';
import { planOperationsPipeline } from '../../src/operations/pipeline/plan.js';
import { renderOperationsGitLabPipeline } from '../../src/operations/gitlab/renderer.js';
import { executionError } from '../../src/core/error/repo-guard-error.js';
import { createDockerDeployment } from '../../src/operations/deployment/docker.js';
import { EXIT_CODES, gateStatusToExitCode } from '../../src/core/result/exit-code.js';
import { waitHealthy, verifyRelease, switchProxy, startCandidate } from '../../src/operations/deployment/runtime.js';
import { notifyDeployment, deploymentMessage } from '../../src/orchestration/cli/deployment-notification.js';

const config = () => ({ name: 'acceptance-api', network: 'acceptance', port: 18081,
  containerPort: 8080, healthUrl: 'http://localhost:18081/api/health' });
const release = (value) => ({ image: `sha256:${value.repeat(64)}`, revision: value.repeat(40) });

test('多层前后端代理只保留当前入口版本头，避免健康检查误判', () => {
  const writes = [];
  switchProxy({ name: 'acceptance-web', config: { ...config(), containerPort: 80 }, labels: [],
    helper() {}, docker() {}, inspect: () => null,
    write: (_, content) => writes.push(content),
  }, { ...release('a'), container: 'acceptance-web-blue' });
  assert.match(writes[0], /proxy_hide_header X-Repo-Guard-Revision;/);
  assert.match(writes[0], /add_header X-Repo-Guard-Revision "a{40}" always/);
});

test('部署通知发生在维护前和开放后，通知异常不改变结果', async () => {
  const f = memory();
  const notices = [];
  await executeBlueGreen(f.adapter, 'deploy', release('a'), { ...f.actions,
    onEvent: async event => {
      notices.push(event);
      if (event.status === 'starting') assert.equal(f.events.includes('proxy:none:true'), false);
      else assert.ok(f.events.includes('proxy:blue:false'));
      throw executionError('test/notification', '通知网络失败');
    },
  });
  assert.deepEqual(notices.map(event => event.status), ['starting', 'passed']);
  assert.equal(f.adapter.state().lastOutcome, 'passed');
});

test('失败通知区分回切成功、恢复失败和首次部署没有旧应用', async () => {
  const f = memory();
  const notices = [];
  const actions = { ...f.actions, onEvent: event => notices.push(event) };
  await executeBlueGreen(f.adapter, 'deploy', release('a'), actions);
  const failing = { ...actions, waitHealthy: async (_, candidate) => {
    if (candidate.color === 'green') throw executionError('test/health', '测试健康失败');
  } };
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), failing));
  assert.equal(notices.at(-1).serviceRestored, true);
  assert.match(deploymentMessage({}, notices.at(-1)), /已切回旧应用/);
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), { ...failing,
    restoreData() { throw executionError('test/restore', '恢复失败'); },
  }));
  assert.equal(notices.at(-1).serviceRestored, false);
  assert.match(deploymentMessage({}, notices.at(-1)), /恢复未确认完成/);
  const initial = memory();
  await assert.rejects(executeBlueGreen(initial.adapter, 'deploy', release('a'), { ...initial.actions,
    onEvent: event => notices.push(event), waitHealthy: async () => { throw executionError('test/notification', '失败'); },
  }));
  assert.equal(notices.at(-1).serviceRestored, false);
});

test('飞书与企业微信独立发送，通知不泄露原始失败消息和凭据', async () => {
  const channels = [{ provider: 'feishu', webhook: 'private-hook', secret: 'private-secret' },
    { provider: 'wecom', webhook: 'other-hook' }];
  const sent = [];
  const results = await notifyDeployment({ enabled: true, channels }, { projectId: 'api', environmentId: 'test' },
    { operation: 'deploy', status: 'failed', started: true, error: executionError('operations/recovery-failed', 'private-secret') },
    { log() {}, send: async (channel, content) => {
      sent.push(content);
      assert.doesNotMatch(content, /private-secret|private-hook/);
      if (channel.provider === 'feishu') throw executionError('test/notification', '发送失败');
    } });
  assert.equal(sent.length, 2);
  assert.deepEqual(results.map(value => value.status), ['execution-error', 'passed']);
  assert.deepEqual(await notifyDeployment({ enabled: false, channels }, {}, {}, { send() { assert.fail(); } }), []);
});

function memory(backupEnabled = true) {
  let state = { version: 2, name: 'acceptance-api', active: null, previous: null, pending: null };
  const events = [];
  let data = ['原有数据'];
  const backups = new Map();
  const adapter = { name: 'acceptance-api', config: { ...config(), backup: { enabled: backupEnabled } },
    initialize() {}, lock() { events.push('lock'); return () => events.push('unlock'); },
    state: () => structuredClone(state), save: (value) => { state = structuredClone(value); },
    stop: (id) => events.push(`stop:${id}`), docker: (args) => events.push(args.join(':')),
    write() {}, inspect: () => ({}),
  };
  const actions = { runtimeEnvironment: () => [], verifyRelease() {}, verifyDataResources() {}, prepareProxy() {},
    switchProxy: (_, target, options) => events.push(`proxy:${target?.color ?? 'none'}:${Boolean(options?.maintenance)}`),
    startCandidate: () => { data.push('新版本测试数据'); },
    backupData: (_, id) => { events.push('backup'); backups.set(id, [...data]); },
    restoreData: (_, id) => { events.push('restore'); data = [...backups.get(id)]; },
    waitHealthy: async (_, target, options) => events.push(`health:${target.color}:${Boolean(options?.publicEntry)}`),
  };
  return { adapter, actions, events, data: () => data, add: value => data.push(value) };
}

test('蓝绿配置拒绝命令注入、错误健康地址、共享根目录和未知字段', () => {
  assert.equal(validateBlueGreen(config()).timeoutSeconds, 120);
  for (const change of [{ name: 'bad;name' }, { port: 80 }, { healthUrl: 'http://user:password@host/api/health' },
    { healthUrl: 'http://host/' }, { unknown: true }, { env: { PASSWORD: 'plain value' } },
    { uploads: { source: '/srv', target: '/uploads' } }, { redis: { container: 'redis', volume: '../data' } }]) {
    assert.throws(() => validateBlueGreen({ ...config(), ...change }), /配置无效/);
  }
});

test('Java Maven 生成原生构建和与手动方式相同的蓝绿入口', (context) => {
  mkdirSync('test/.tmp', { recursive: true });
  const root = mkdtempSync(path.resolve('test/.tmp/java-ops-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  const ops = { version: 2, enabled: true, projects: { api: { enabled: true,
    build: { command: 'mvn', args: ['-B', 'clean', 'package'] }, artifactPaths: ['target/app.jar'],
    environments: { test: { production: false, branches: ['test'], blueGreen: config() } },
  } } };
  const normalized = validateOperationsConfig(ops);
  assert.deepEqual(validateOperationsConfig(normalized), normalized);
  const plan = planOperationsPipeline(root, ops, [{ id: 'api', root: '.', stack: 'java' }]);
  assert.equal(plan.projects[0].runtime, 'java');
  assert.match(plan.projects[0].build.command, /mvn.*clean.*package/);
  assert.match(renderOperationsGitLabPipeline(plan), /repo-guard ops deploy --project api --environment test/);
});

test('健康检查通过才开放入口，第二次部署交替颜色并保留恢复点', async () => {
  const f = memory();
  const first = await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  assert.equal(first.active.color, 'blue');
  assert.ok(f.events.indexOf('health:blue:true') < f.events.indexOf('proxy:blue:false'));
  f.events.length = 0;
  const second = await executeBlueGreen(f.adapter, 'deploy', release('b'), f.actions);
  assert.equal(second.active.color, 'green');
  assert.equal(second.previous.image, first.active.image);
  assert.match(second.previous.restorePoint, /^backup-/);
  assert.ok(f.events.indexOf('stop:acceptance-api-blue') < f.events.indexOf('backup'));
});

test('候选健康失败恢复数据和旧应用，发布仍返回执行错误', async () => {
  const f = memory();
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  const before = [...f.data()];
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), { ...f.actions,
    waitHealthy: async (_, candidate) => { if (candidate.color === 'green') throw executionError('test/health', '测试健康失败'); },
  }), { code: 'operations/deployment-failed' });
  assert.deepEqual(f.data(), before);
  assert.equal(f.adapter.state().active.color, 'blue');
  assert.equal(f.adapter.state().pending, null);
  assert.equal(gateStatusToExitCode('execution-error'), EXIT_CODES.error);
});

test('正式入口健康失败也恢复；恢复失败保留待恢复记录', async () => {
  const f = memory();
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), { ...f.actions,
    waitHealthy: async (_, candidate, options) => { if (candidate.color === 'green' && options?.publicEntry) throw executionError('test/public', '测试入口失败'); },
    restoreData() { throw executionError('test/restore', '测试恢复失败'); },
  }), { code: 'operations/recovery-failed' });
  assert.ok(f.adapter.state().pending);
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('c'), f.actions), { code: 'operations/recovery-required' });
  await executeBlueGreen(f.adapter, 'recover', null, f.actions);
  assert.equal(f.adapter.state().active.color, 'blue');
});

test('数据随整套回滚恢复，回滚前也建立快照支持再次切换', async () => {
  const f = memory();
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  const before = [...f.data()];
  await executeBlueGreen(f.adapter, 'deploy', release('b'), f.actions);
  f.add('发布后写入');
  const newer = [...f.data()];
  await executeBlueGreen(f.adapter, 'rollback', null, f.actions);
  assert.deepEqual(f.data(), before);
  await executeBlueGreen(f.adapter, 'rollback', null, f.actions);
  assert.deepEqual(f.data(), newer);
});

test('备份默认关闭，启用时必须提供资源，上传挂载不依赖备份', () => {
  const uploads = { source: '/srv/app/uploads', target: '/uploads' };
  assert.equal(validateBlueGreen(config()).backup.enabled, false);
  const value = validateBlueGreen({ ...config(), uploads });
  assert.deepEqual(validateBlueGreen(value), value);
  for (const backup of [null, {}, { enabled: 'true' }, { enabled: true }, { enabled: false, unknown: 1 }]) {
    assert.throws(() => validateBlueGreen({ ...config(), backup }), /配置无效/);
  }
  assert.equal(validateBlueGreen({ ...config(), uploads, backup: { enabled: true } }).backup.enabled, true);
  const commands = [];
  startCandidate({ config: value, labels: [], remove() {}, docker: args => commands.push(args) },
    { ...release('a'), container: 'acceptance-api-blue' }, []);
  assert.ok(commands[0].includes('type=bind,source=/srv/app/uploads,target=/uploads'));
});

test('持久化状态接受无备份中断，拒绝没有恢复点却声明快照完成', () => {
  const record = { version: 2, name: 'acceptance-api', active: null, previous: null,
    pending: { old: null, next: null, restorePoint: null, backupComplete: false } };
  const adapter = createDockerDeployment(validateBlueGreen(config()), { command: args => {
    if (args[0] === 'volume' && args[1] === 'ls') return 'acceptance-api-state';
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{ Labels: { 'com.repo-guard.deployment': 'acceptance-api' } }]);
    return JSON.stringify(record);
  } });
  assert.deepEqual(adapter.state(), record);
  record.pending.backupComplete = true;
  assert.throws(() => adapter.state(), { code: 'operations/state-invalid' });
});

test('普通发布不检查备份资源，正式入口检查通过后才停止旧应用，回滚保留写入', async () => {
  const f = memory(false);
  const actions = { ...f.actions, verifyDataResources() { assert.fail('不应检查备份权限'); },
    backupData() { assert.fail('不应备份'); }, restoreData() { assert.fail('不应恢复数据'); } };
  await executeBlueGreen(f.adapter, 'deploy', release('a'), actions);
  f.events.length = 0;
  const result = await executeBlueGreen(f.adapter, 'deploy', release('b'), actions);
  assert.equal(result.previous.restorePoint, null);
  assert.equal(f.events.includes('proxy:none:true'), false);
  assert.equal(f.events.includes('proxy:green:true'), false);
  assert.ok(f.events.indexOf('health:green:true') < f.events.indexOf('stop:acceptance-api-blue'));
  f.add('上线后用户写入');
  const data = [...f.data()];
  await executeBlueGreen(f.adapter, 'rollback', null, actions);
  assert.deepEqual(f.data(), data);
  await executeBlueGreen(f.adapter, 'rollback', null, actions);
  assert.deepEqual(f.data(), data);
});

test('普通发布入口失败自动回退应用，保留新版本写入并准确通知', async () => {
  const f = memory(false);
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  const notices = [];
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), { ...f.actions,
    onEvent: event => notices.push(event),
    waitHealthy: async (_, candidate, options) => {
      if (candidate.color === 'green' && options?.publicEntry) throw executionError('operations/health-failed', '入口失败');
    },
  }), { code: 'operations/deployment-failed' });
  assert.equal(f.adapter.state().active.color, 'blue');
  assert.equal(f.data().filter(value => value === '新版本测试数据').length, 2);
  assert.equal(f.events.includes('restore'), false);
  assert.match(deploymentMessage({}, notices[0]), /旧应用继续服务/);
  assert.match(deploymentMessage({}, notices.at(-1)), /已切回旧应用.*当前数据保持不变/);
  assert.doesNotMatch(deploymentMessage({}, notices.at(-1)), /恢复发布前快照|备份恢复权限/);
});

test('普通回退也不健康则保持维护，恢复命令在修复后仅恢复应用', async () => {
  const f = memory(false);
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), { ...f.actions,
    waitHealthy: async () => { throw executionError('operations/health-failed', '数据库不兼容'); },
  }), { code: 'operations/recovery-failed' });
  assert.ok(f.adapter.state().pending);
  assert.equal(f.adapter.state().pending.restorePoint, null);
  assert.equal(f.events.filter(value => value.startsWith('proxy:')).at(-1), 'proxy:none:true');
  await executeBlueGreen(f.adapter, 'recover', null, f.actions);
  assert.equal(f.adapter.state().pending, null);
  assert.equal(f.events.includes('restore'), false);
});

test('开启备份后不能用无快照历史回滚；关闭后允许只回退应用', async () => {
  const f = memory(false);
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  await executeBlueGreen(f.adapter, 'deploy', release('b'), f.actions);
  f.adapter.config.backup.enabled = true;
  await assert.rejects(executeBlueGreen(f.adapter, 'rollback', null, f.actions), { code: 'operations/backup-missing' });
  assert.equal(f.adapter.state().pending, null);
  f.adapter.config.backup.enabled = false;
  await executeBlueGreen(f.adapter, 'rollback', null, f.actions);
  assert.equal(f.adapter.state().active.color, 'blue');
});

test('备份模式中断后关闭开关，恢复仍按待恢复记录恢复快照', async () => {
  const f = memory();
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  const before = [...f.data()];
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('b'), { ...f.actions,
    waitHealthy: async () => { throw executionError('operations/health-failed', '候选失败'); },
    restoreData() { throw executionError('test/restore', '恢复中断'); },
  }), { code: 'operations/recovery-failed' });
  f.adapter.config.backup.enabled = false;
  const notices = [];
  await executeBlueGreen(f.adapter, 'recover', null, { ...f.actions, onEvent: event => notices.push(event) });
  assert.deepEqual(f.data(), before);
  assert.equal(notices[0].backupEnabled, true);
});

test('显式恢复先进入维护，即使旧容器校验失败也发送恢复失败通知', async () => {
  const f = memory();
  await executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions);
  const state = f.adapter.state();
  f.adapter.save({ ...state, pending: { old: state.active, backupComplete: false } });
  f.events.length = 0;
  const notices = [];
  await assert.rejects(executeBlueGreen(f.adapter, 'recover', null, { ...f.actions,
    verifyRelease() {
      assert.ok(f.events.includes('proxy:none:true'));
      throw executionError('operations/runtime-mismatch', '旧容器被替换');
    },
    onEvent: event => notices.push(event),
  }), { code: 'operations/recovery-failed' });
  assert.equal(notices.at(-1).status, 'failed');
  assert.equal(notices.at(-1).serviceRestored, false);
  assert.ok(f.adapter.state().pending);
});

test('备份失败不能启动候选，部署锁冲突不能修改状态', async () => {
  const f = memory();
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('a'), { ...f.actions,
    backupData() { throw executionError('test/backup', '备份失败'); },
    startCandidate() { assert.fail('不应启动候选'); },
  }), { code: 'operations/deployment-failed' });
  assert.deepEqual(f.data(), ['原有数据']);
  f.adapter.lock = () => { throw executionError('test/lock', '已被其他部署锁定'); };
  const previous = f.adapter.state();
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('a'), f.actions));
  assert.deepEqual(f.adapter.state(), previous);
});

test('真实 CLI 缺少项目选择时返回统一配置错误，不执行 Docker', () => {
  const result = spawnSync(process.execPath, ['bin/repo-guard.js', 'ops', 'deploy'], { encoding: 'utf8' });
  assert.equal(result.status, EXIT_CODES.error);
  assert.match(result.stdout + result.stderr, /operations\/deployment-selection/);
});

test('正式健康探针拒绝重定向和旧版本，只接受本次版本的 200', async () => {
  const candidate = release('a');
  const responses = [{ status: 302, revision: candidate.revision }, { status: 200, revision: 'old' },
    { status: 200, revision: candidate.revision }];
  let calls = 0;
  const adapter = { config: { ...config(), timeoutSeconds: 1 }, docker: () => JSON.stringify(responses[calls++]) };
  await waitHealthy(adapter, candidate, { publicEntry: true, sleep: async () => {} });
  assert.equal(calls, 3);
});

test('恢复前必须核对实际镜像和源码标签，不能启动被替换的旧容器', () => {
  const candidate = release('a');
  assert.throws(() => verifyRelease({ inspect: () => ({ Image: release('b').image,
    Config: { Labels: { 'com.repo-guard.revision': candidate.revision } } }) }, candidate), /版本不一致/);
});

test('服务器操作状态不确定时保留锁和记录，不并发恢复数据', async () => {
  const f = memory();
  await assert.rejects(executeBlueGreen(f.adapter, 'deploy', release('a'), { ...f.actions,
    backupData() { throw executionError('operations/docker-uncertain', '测试服务器操作超时'); },
    restoreData() { assert.fail('操作状态不确定时不得恢复'); },
  }), { code: 'operations/docker-uncertain' });
  assert.ok(f.adapter.state().pending);
  assert.equal(f.events.includes('unlock'), false);
});
