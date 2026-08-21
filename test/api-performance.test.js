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
import { validateConfig } from '../src/config/configuration-validation.js';
import { isRepoGuardError } from '../src/core/error/repo-guard-error.js';
import { createProjectGateRegistry } from '../src/gates/registry.js';
import { runApiPerformanceExternalRunner } from '../src/gates/testing/api-performance-external-runner.js';
import { runApiPerformanceRunner } from '../src/orchestration/cli/api-performance-runner.js';
import { createProjectCiFullPlan } from '../src/orchestration/execution-plans.js';
import { runExternalManualGate } from '../src/orchestration/cli/manual-gates.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = path.join(process.cwd(), 'bin', 'repo-guard.js');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function projectConfig(environments = ['manual']) {
  return {
    version: 1,
    notification: { enabled: false },
    externalGates: [{
      id: 'project.api-performance',
      enabled: true,
      environments,
      script: 'test:api-performance:runner',
      timeoutMs: 30000,
      report: {
        format: 'repo-guard-json-v1',
        path: 'reports/api-performance/axios-gate.json',
      },
    }],
    dependencyPolicy: { enabled: false },
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      maxFileLines: { enabled: false },
    },
    rules: [{ pattern: 'src/**', category: '源码', level: 'audit' }],
  };
}

function performanceConfig({
  scenario = 'test/performance/scenarios/read.perf.mjs',
  allowWrites = false,
  p95Ms = 10000,
  p99Ms = 10000,
  errorRate = 0,
} = {}) {
  return `${JSON.stringify({
    target: {
      baseUrlEnv: 'REPO_GUARD_TEST_PERF_BASE_URL',
      allowedHosts: ['api-test.example.com'],
      confirmationEnv: 'REPO_GUARD_TEST_PERF_CONFIRM_HOST',
    },
    client: { module: 'test/performance/axios-client.mjs' },
    scenarios: [scenario],
    execution: { warmupIterations: 2, iterations: 10, concurrency: 2 },
    thresholds: { p95Ms, p99Ms, errorRate },
    safety: { allowWrites },
  }, null, 2)}\n`;
}

function createFixture({
  environments = ['manual'],
  scenarioSource = `export default {
  name: '查询当前用户',
  method: 'GET',
  pathLabel: '/user/current',
  async run({ client }) { await client.request(); }
};\n`,
  configSource = performanceConfig(),
} = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'api-performance-'));
  git(root, ['init']);
  mkdirSync(path.join(root, 'test', 'performance', 'scenarios'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'reports/\n');
  const cli = CLI_PATH.replaceAll('\\', '/');
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'api-performance-fixture',
    version: '1.0.0',
    scripts: {
      'test:api-performance:runner': `node "${cli}" api-performance-runner --gate-id project.api-performance --config test/performance/api-performance.config.json`,
    },
  }, null, 2)}\n`);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(projectConfig(environments), null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'test', 'performance', 'api-performance.config.json'),
    configSource,
  );
  writeFileSync(
    path.join(root, 'test', 'performance', 'axios-client.mjs'),
    `export function createPerformanceClient({ baseURL, runId }) {
  void baseURL;
  void runId;
  return { async request() { await new Promise((resolve) => setTimeout(resolve, 1)); } };
}\n`,
  );
  writeFileSync(
    path.join(root, 'test', 'performance', 'scenarios', 'read.perf.mjs'),
    scenarioSource,
  );
  return root;
}

async function withPerformanceEnvironment(callback) {
  const values = {
    ...environment(),
    CI: 'false',
    GITLAB_CI: 'false',
    GITHUB_ACTIONS: 'false',
    BUILD_BUILDID: '',
    JENKINS_URL: '',
  };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function environment(extra = {}) {
  return {
    REPO_GUARD_TEST_PERF_BASE_URL: 'https://api-test.example.com/v1/',
    REPO_GUARD_TEST_PERF_CONFIRM_HOST: 'api-test.example.com',
    ...extra,
  };
}

test('生成通过状态的外部门禁 JSON 和中文 HTML 报告', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const report = await runApiPerformanceExternalRunner({
    root,
    gateId: 'project.api-performance',
    reportPath: 'reports/api-performance/axios-gate.json',
    configFile: 'test/performance/api-performance.config.json',
    environment: environment(),
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.scenarioCount, 1);
  assert.equal(report.metrics.totalSamples, 10);
  assert.equal(report.artifacts[0].path, 'reports/api-performance/axios-report.html');
  const persisted = JSON.parse(readFileSync(
    path.join(root, 'reports', 'api-performance', 'axios-gate.json'),
    'utf8',
  ));
  assert.deepEqual(persisted, report);
  const html = readFileSync(
    path.join(root, 'reports', 'api-performance', 'axios-report.html'),
    'utf8',
  );
  assert.match(html, /接口性能测试报告/);
  assert.match(html, /api-test\.example\.com/);
  assert.doesNotMatch(html, /REPO_GUARD_TEST_PERF/);
});

test('正式样本失败时生成阈值违规并使用退出码 2', async (context) => {
  const root = createFixture({
    scenarioSource: `let invocation = 0;
export default {
  name: '失败率场景',
  method: 'GET',
  pathLabel: '/unstable',
  async run() {
    invocation += 1;
    if (invocation > 2) return Promise.reject('模拟失败');
  }
};\n`,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const exitCode = await runApiPerformanceRunner({
    gateId: 'project.api-performance',
    configFile: 'test/performance/api-performance.config.json',
    cwd: root,
    environment: environment(),
  });

  assert.equal(exitCode, 2);
  const report = JSON.parse(readFileSync(
    path.join(root, 'reports', 'api-performance', 'axios-gate.json'),
    'utf8',
  ));
  assert.equal(report.status, 'violation');
  assert.equal(report.findings[0].ruleId, 'api-performance/error-rate-exceeded');
  assert.equal(report.metrics.failedSamples, 10);
});

test('CLI 子命令只在显式调用时执行并生成外部门禁报告', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const childEnvironment = {
    ...process.env,
    ...environment(),
    CI: 'false',
    GITLAB_CI: 'false',
    GITHUB_ACTIONS: 'false',
  };
  delete childEnvironment.BUILD_BUILDID;
  delete childEnvironment.JENKINS_URL;
  const result = spawnSync(process.execPath, [
    CLI_PATH,
    'api-performance-runner',
    '--gate-id',
    'project.api-performance',
    '--config',
    'test/performance/api-performance.config.json',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: childEnvironment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /接口性能测试已通过/);
  assert.equal(JSON.parse(readFileSync(
    path.join(root, 'reports', 'api-performance', 'axios-gate.json'),
    'utf8',
  )).status, 'passed');
});

test('完整手动外部门禁接受 runner 生成的协议报告和中文产物', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await withPerformanceEnvironment(() => (
    runExternalManualGate('project.api-performance', root)
  ));

  assert.equal(result.status, 'passed', JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.metrics.totalSamples, 10);
  assert.deepEqual(result.artifacts.map(({ path: artifactPath }) => artifactPath), [
    'reports/api-performance/axios-gate.json',
    'reports/api-performance/axios-report.html',
  ]);
});

test('拒绝没有双重授权和清理函数的写请求场景', async (context) => {
  const root = createFixture({
    configSource: performanceConfig({
      scenario: 'test/performance/scenarios/read.perf.mjs',
      allowWrites: true,
    }),
    scenarioSource: `export default {
  name: '创建测试数据',
  method: 'POST',
  pathLabel: '/records',
  async run() {}
};\n`,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceExternalRunner({
      root,
      gateId: 'project.api-performance',
      reportPath: 'reports/api-performance/axios-gate.json',
      configFile: 'test/performance/api-performance.config.json',
      environment: environment(),
    }),
    (error) => isRepoGuardError(error)
      && error.code === 'api-performance/write-request-not-authorized',
  );
});

test('写请求清理失败时不生成可被误认为有效的主报告', async (context) => {
  const root = createFixture({
    configSource: performanceConfig({ allowWrites: true }),
    scenarioSource: `export default {
  name: '创建并清理测试数据',
  method: 'POST',
  pathLabel: '/records',
  allowWrites: true,
  async run() {},
  async cleanup() { return Promise.reject('模拟清理失败'); }
};\n`,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceExternalRunner({
      root,
      gateId: 'project.api-performance',
      reportPath: 'reports/api-performance/axios-gate.json',
      configFile: 'test/performance/api-performance.config.json',
      environment: environment(),
    }),
    (error) => isRepoGuardError(error) && error.code === 'api-performance/cleanup-failed',
  );
  assert.throws(() => readFileSync(
    path.join(root, 'reports', 'api-performance', 'axios-gate.json'),
    'utf8',
  ));
});

test('拒绝未精确确认的目标主机且不生成主报告', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceExternalRunner({
      root,
      gateId: 'project.api-performance',
      reportPath: 'reports/api-performance/axios-gate.json',
      configFile: 'test/performance/api-performance.config.json',
      environment: environment({ REPO_GUARD_TEST_PERF_CONFIRM_HOST: 'other.example.com' }),
    }),
    (error) => isRepoGuardError(error) && error.code === 'api-performance/host-not-confirmed',
  );
  assert.throws(() => readFileSync(
    path.join(root, 'reports', 'api-performance', 'axios-gate.json'),
    'utf8',
  ));
});

test('场景模块无法加载时返回中文配置错误', async (context) => {
  const root = createFixture({ scenarioSource: 'export default {\n' });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceExternalRunner({
      root,
      gateId: 'project.api-performance',
      reportPath: 'reports/api-performance/axios-gate.json',
      configFile: 'test/performance/api-performance.config.json',
      environment: environment(),
    }),
    (error) => isRepoGuardError(error)
      && error.code === 'api-performance/module-load-failed'
      && /无法加载性能测试场景模块/.test(error.message),
  );
});

test('拒绝使用非 JSON 主报告路径', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceExternalRunner({
      root,
      gateId: 'project.api-performance',
      reportPath: 'reports/api-performance/axios-gate.txt',
      configFile: 'test/performance/api-performance.config.json',
      environment: environment(),
    }),
    (error) => isRepoGuardError(error)
      && error.code === 'api-performance/invalid-primary-report-extension',
  );
});

test('拒绝把接口性能 runner 配置到自动执行环境', async (context) => {
  const root = createFixture({ environments: ['manual', 'ci-full'] });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceRunner({
      gateId: 'project.api-performance',
      configFile: 'test/performance/api-performance.config.json',
      cwd: root,
      environment: environment(),
    }),
    (error) => isRepoGuardError(error) && error.code === 'api-performance/not-manual-only',
  );
});

test('即使配置为 manual 也拒绝在 CI 环境运行性能 runner', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    runApiPerformanceRunner({
      gateId: 'project.api-performance',
      configFile: 'test/performance/api-performance.config.json',
      cwd: root,
      environment: environment({ GITLAB_CI: 'true' }),
    }),
    (error) => isRepoGuardError(error)
      && error.code === 'api-performance/automated-environment-rejected',
  );
});

test('手动接口性能外部门禁不会进入固定 CI full 计划', () => {
  const config = validateConfig(projectConfig());
  const registry = createProjectGateRegistry(config);
  const plan = createProjectCiFullPlan(config, registry);
  assert.equal(plan.steps.some(({ id }) => id === 'project.api-performance'), false);
});
