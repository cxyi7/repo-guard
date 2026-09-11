import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCiGate } from '../../../src/orchestration/ci/runner.js';
import { validateConfig } from '../../../src/config/configuration-validation.js';
import {
  createChangeSet,
  createGateContext,
} from '../../../src/core/capability/gate-context.js';
import { createProjectGateRegistry } from '../../../src/gates/registry.js';
import { releaseEnvironment } from '../../../src/integrations/npm/release-environment.js';
import {
  createProjectReleaseReadyPlan,
  ciFullPlan,
  releaseReadyPlan,
} from '../../../src/orchestration/execution-plans.js';
import { syncAgentPolicies } from '../../../src/policies/agent-policies.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });
const FRONTEND = {
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-javascript',
};
const BACKEND = {
  id: 'api',
  role: 'backend',
  stack: 'node',
  preset: 'node-typescript',
};
const JAVA = { id: 'java-api', role: 'backend', stack: 'java', preset: 'java-maven' };
const EXTERNAL = {
  id: 'project.contract',
  enabled: true,
  environments: ['release-ready'],
  script: 'test:contract',
  timeoutMs: 1000,
  report: { format: 'repo-guard-json-v2', path: 'reports/contract.json' },
};

function fixture(context, scripts = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'release-ready-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  // 普通私有消费应用没有包发布元数据、README 版本或 npm 打包脚本。
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ private: true, type: 'module', scripts }),
  );
  writeFileSync(path.join(root, 'index.js'), 'export const ready = true;\n');
  return root;
}

function config(project = FRONTEND, externalGates = []) {
  return validateConfig({
    version: 2,
    project,
    checks: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      filePlacement: { enabled: false },
      maxFileLines: { enabled: false },
    },
    repository: {
      rules: [{ pattern: 'index.js', category: '源码', level: 'audit' }],
      dependencyPolicy: { enabled: false, requireLockfile: false },
    },
    reporting: { notification: { enabled: false } },
    ci: {
      enabled: true,
      profile: 'release-ready',
      reportPath: 'reports/release-ready.json',
      externalGates,
    },
  });
}

function git(root, argumentsList) {
  const result = spawnSync('git', argumentsList, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gateContext(root, projectConfig) {
  return createGateContext({
    root,
    environment: 'release-ready',
    config: projectConfig,
    changes: createChangeSet({ source: 'ci' }),
    files: [],
    artifactDirectory: path.join(root, 'reports'),
  });
}

test('所有消费项目使用同一个工程交付检查计划，而不是 npm 包发布计划', () => {
  const expected = [
    ...ciFullPlan.steps.map(({ id }) => id),
    'quality.lighthouse',
    'release.delivery-evidence',
  ];
  assert.deepEqual(
    releaseReadyPlan.steps.map(({ id }) => id),
    expected,
  );
  for (const descriptor of [FRONTEND, BACKEND, JAVA]) {
    const projectConfig = config(descriptor);
    const registry = createProjectGateRegistry(projectConfig);
    assert.deepEqual(
      createProjectReleaseReadyPlan(projectConfig, registry).steps.map(
        ({ id }) => id,
      ),
      expected,
    );
    for (const removed of [
      'release.check',
      'release.test',
      'release.package',
    ]) {
      assert.equal(
        registry.all.some(({ id }) => id === removed),
        false,
      );
    }
  }
});

test('项目外部门禁在最终交付证据复核前执行，并可显式排除', () => {
  const projectConfig = config(FRONTEND, [EXTERNAL]);
  const registry = createProjectGateRegistry(projectConfig);
  const plan = createProjectReleaseReadyPlan(projectConfig, registry);
  assert.deepEqual(
    plan.steps.slice(-3).map(({ id }) => id),
    ['quality.lighthouse', 'project.contract', 'release.delivery-evidence'],
  );
  assert.equal(
    createProjectReleaseReadyPlan(projectConfig, registry, {
      includeExternalGates: false,
    }).steps.some(({ id }) => id === EXTERNAL.id),
    false,
  );
});

test('交付外部门禁拒绝发布与部署脚本，且执行环境移除发布凭据', (context) => {
  const root = fixture(context, { 'test:contract': 'node scripts/publish.js' });
  const projectConfig = config(FRONTEND, [EXTERNAL]);
  assert.throws(
    () =>
      createProjectGateRegistry(projectConfig)
        .get(EXTERNAL.id)
        .inspectSetup(gateContext(root, projectConfig)),
    /不得执行发布或部署/,
  );
  assert.deepEqual(
    releaseEnvironment({
      PATH: 'safe',
      CI: 'true',
      NPM_TOKEN: 'forbidden',
      DEPLOY_PASSWORD: 'forbidden',
      AWS_ACCESS_KEY_ID: 'forbidden',
    }),
    {
      PATH: 'safe',
      CI: 'true',
      npm_config_userconfig: process.platform === 'win32' ? 'NUL' : '/dev/null',
    },
  );
});

for (const descriptor of [FRONTEND, BACKEND, JAVA]) {
  test(`${descriptor.preset} 私有消费项目可完成只读交付检查，无需 check/test/pack:check`, async (context) => {
    const root = fixture(context);
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'chore: baseline']);
    const base = git(root, ['rev-parse', 'HEAD']);
    writeFileSync(
      path.join(root, 'index.js'),
      'export const ready = true;\nexport const next = true;\n',
    );
    git(root, ['add', 'index.js']);
    git(root, ['commit', '-m', 'feat: next']);
    const head = git(root, ['rev-parse', 'HEAD']);
    const projectConfig = config(descriptor);
    syncAgentPolicies(root, projectConfig);
    const sourceBefore = readFileSync(path.join(root, 'index.js'), 'utf8');
    assert.equal(
      await runCiGate({ root, config: projectConfig, base, head, env: {} }),
      0,
    );
    const report = JSON.parse(
      readFileSync(path.join(root, 'reports/release-ready.json'), 'utf8'),
    );
    assert.equal(report.profile, 'release-ready');
    assert.equal(report.status, 'passed');
    assert.deepEqual(
      report.steps.slice(-2).map(({ name, status }) => ({ name, status })),
      [
        { name: 'quality.lighthouse', status: 'skipped' },
        { name: 'release.delivery-evidence', status: 'skipped' },
      ],
    );
    for (const [name, applicable] of [
      ['build', descriptor.stack === 'node'],
      ['java.build', descriptor.stack === 'java'],
    ]) {
      const build = report.steps.find((step) => step.name === name);
      assert.ok(build, `交付计划必须包含 ${name}`);
      assert.ok(report.steps.indexOf(build) < report.steps.length - 2);
      assert.equal(build.status, 'skipped');
      if (applicable) assert.doesNotMatch(build.gateResult.summary, /不适用于/);
      else assert.match(build.gateResult.summary, /不适用于/);
    }
    assert.equal(
      report.steps.some(({ name }) =>
        ['release.check', 'release.test', 'release.package'].includes(name),
      ),
      false,
    );
    assert.equal(
      readFileSync(path.join(root, 'index.js'), 'utf8'),
      sourceBefore,
    );
    assert.equal(
      readdirSync(root).some((file) => file.endsWith('.tgz')),
      false,
    );
  });
}
