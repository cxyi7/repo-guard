import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import {
  normalizeProjectDocument,
  serializeProjectConfig,
} from '../../src/config/project-configuration.js';
import { PROJECT_CHECK_PATHS } from '../../src/config/project-feature-paths.js';
import { runSourceSecurity } from '../../src/gates/security/source-security-gate.js';
import { sourceSecurityGate } from '../../src/gates/security/source-security-gate.js';
import { gateRegistry } from '../../src/gates/registry.js';
import { validateCiGatePolicy } from '../../src/orchestration/ci/gate-policy.js';
import { gateResultToExitCode } from '../../src/core/result/gate-result.js';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';
import { executionPlans } from '../../src/orchestration/execution-plans.js';
import { runQualityGate } from '../../src/orchestration/pre-commit/lint-staged-gate.js';

const project = {
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-typescript',
};
function configuration(overrides = {}) {
  return normalizeProjectDocument({
    version: 2,
    project,
    checks: {
      ...Object.fromEntries(
        Object.keys(PROJECT_CHECK_PATHS)
          .filter((key) => key !== 'sourceSecurity')
          .map((key) => [key, { enabled: false }]),
      ),
      sourceSecurity: overrides,
    },
    repository: {
      dependencyPolicy: { enabled: false },
      codePlacement: { enabled: false },
    },
  });
}
function fixture(t) {
  const temporary = path.resolve('test/.tmp');
  mkdirSync(temporary, { recursive: true });
  const root = mkdtempSync(path.join(temporary, 'source-security-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = configuration();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  return {
    root,
    config,
    write,
    run: (files, extra = {}) =>
      runSourceSecurity({ root, config, files, ...extra }),
  };
}

test('Schema、配置默认值、序列化和非法字段校验保持一致', () => {
  const config = configuration({
    htmlInjection: { allowEmptyClear: false },
    newWindow: { requireNoreferrer: false },
  });
  assert.equal(config.checks.sourceSecurity.enabled, true);
  assert.equal(config.checks.sourceSecurity.htmlInjection.vueVHtml, true);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));
  const validate = ajv.compile(schema);
  assert.equal(
    validate(serializeProjectConfig(config)),
    true,
    JSON.stringify(validate.errors),
  );
  for (const descriptor of [
    { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' },
  ]) {
    const candidate = {
      version: 2,
      project: descriptor,
      checks: { sourceSecurity: { enabled: true } },
    };
    assert.equal(validate(candidate), false);
    assert.throws(() => normalizeProjectDocument(candidate));
  }
  for (const options of [
    { mystery: true },
    { dynamicCode: { eval: 'yes' } },
    { include: [] },
    { include: ['../outside/**'] },
    { htmlInjection: { sanitizer: 'safe' } },
  ])
    assert.throws(() => configuration(options));
});

test('真实源码位置和退出码：违规、解析失败、无法确认、空范围、通过', (t) => {
  const f = fixture(t);
  f.write('old/name.js', 'window.postMessage(data, "*")');
  assert.equal(
    gateResultToExitCode(f.run(['old/name.js'])),
    EXIT_CODES.violation,
  );
  f.write('old/name.js', 'const =');
  assert.equal(gateResultToExitCode(f.run(['old/name.js'])), EXIT_CODES.error);
  f.write('old/name.js', 'window.postMessage(data, origin)');
  assert.equal(f.run(['old/name.js']).status, 'skipped');
  assert.equal(f.run(['old/name.js']).metrics.unconfirmed, 1);
  assert.equal(f.run([]).status, 'skipped');
  f.write('old/name.js', 'window.postMessage(data, "https://example.com")');
  assert.equal(f.run(['old/name.js']).status, 'passed');
});

test('仅按显式范围检查，不假定 src 目录，也不读取未提供的 Hook 文件', (t) => {
  const f = fixture(t);
  f.write('legacy-code/a.js', 'window.postMessage(data,"https://example.com")');
  f.write('legacy-code/b.js', 'eval(data)');
  assert.equal(f.run(['legacy-code/a.js']).status, 'passed');
  assert.equal(
    f.run(['legacy-code/a.js', 'legacy-code/b.js']).status,
    'violation',
  );
  f.config.checks.sourceSecurity.exclude.push('legacy-code/b.js');
  assert.equal(
    f.run(['legacy-code/a.js', 'legacy-code/b.js']).status,
    'passed',
  );
});

test('关闭检查不删除配置，关闭分类不影响其他分类', (t) => {
  const f = fixture(t);
  f.write('a.js', 'eval(data); window.postMessage(data,"*")');
  f.config.checks.sourceSecurity.dynamicCode.enabled = false;
  assert.equal(f.run(['a.js']).findings.length, 1);
  f.config.checks.sourceSecurity.enabled = false;
  assert.equal(f.run(['a.js']).status, 'skipped');
  assert.equal(f.config.checks.sourceSecurity.crossWindowMessage.enabled, true);
});

test('手动与 CI 使用同一完整规则集，旧门禁未注册', (t) => {
  const f = fixture(t);
  f.write('a.js', 'eval(data)');
  f.write('a.vue', '<template><div v-html="data"/></template>');
  f.write('index.html', '<script>eval(data)</script>');
  const files = ['a.js', 'a.vue', 'index.html'];
  for (const environment of [
    'manual',
    'pre-commit',
    'ci-policy',
    'ci-full',
    'release-ready',
  ]) {
    const result = sourceSecurityGate.run({
      root: f.root,
      config: f.config,
      environment,
      plan: sourceSecurityGate.plan({ files }),
    });
    assert.equal(result.findings.length, 3);
    assert.equal(result.status, 'violation');
  }
  for (const id of [
    'security.dynamic-code',
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
  ])
    assert.throws(() => gateRegistry.get(id));
  for (const name of ['pre-commit', 'ci-policy', 'ci-full', 'release-ready'])
    assert.equal(
      executionPlans
        .get(name)
        .steps.filter((step) => step.gateId.startsWith('security.')).length,
      1,
    );
});

test('真实 CLI 检查任意目录并返回统一退出码', (t) => {
  const f = fixture(t);
  const git = spawnSync('git', ['init', '-q'], {
    cwd: f.root,
    encoding: 'utf8',
  });
  assert.equal(git.status, 0, git.stderr);
  f.write(
    'repo-guard.config.json',
    JSON.stringify(serializeProjectConfig(f.config)),
  );
  f.write('LegacyFolder/file.js', 'eval(data)');
  for (const command of ['source-security']) {
    const result = spawnSync(
      process.execPath,
      [path.resolve('bin/repo-guard.js'), command],
      { cwd: f.root, encoding: 'utf8' },
    );
    assert.equal(
      result.status,
      EXIT_CODES.violation,
      result.stdout + result.stderr,
    );
    assert.match(result.stdout + result.stderr, /security\/no-eval/);
  }
});

test('真实 Hook：仅 HTML 暂存文件也执行安全检查，成功和失败均保留部分暂存状态', async (t) => {
  const f = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: f.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  f.write(
    'repo-guard.config.json',
    JSON.stringify(serializeProjectConfig(f.config)),
  );
  f.write('Legacy/index.html', '<a href="/">打开</a>\n');
  git('add', '.');
  git(
    '-c',
    'user.name=测试',
    '-c',
    'user.email=test@example.com',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    '初始测试',
  );
  const staged = '<a href="/safe">打开</a>\n';
  const unstaged = staged + '<a href="javascript:x">未暂存</a>\n';
  f.write('Legacy/index.html', staged);
  git('add', 'Legacy/index.html');
  const stagedSnapshot = git('show', ':Legacy/index.html');
  f.write('Legacy/index.html', unstaged);
  assert.equal(await runQualityGate({ cwd: f.root }), EXIT_CODES.success);
  assert.equal(git('show', ':Legacy/index.html'), stagedSnapshot);
  assert.equal(
    readFileSync(path.join(f.root, 'Legacy/index.html'), 'utf8'),
    unstaged,
  );
  git('add', 'Legacy/index.html');
  const badSnapshot = git('show', ':Legacy/index.html');
  const working = unstaged + '<p>独立未暂存改动</p>\n';
  f.write('Legacy/index.html', working);
  assert.equal(await runQualityGate({ cwd: f.root }), EXIT_CODES.violation);
  assert.equal(git('show', ':Legacy/index.html'), badSnapshot);
  assert.equal(
    readFileSync(path.join(f.root, 'Legacy/index.html'), 'utf8'),
    working,
  );
});

test('Doctor 提示遵循唯一入口总开关', () => {
  const config = configuration({ enabled: false });
  assert.equal(sourceSecurityGate.inspectSetup({ config }).status, 'disabled');
});

test('旧命令和旧 CI Gate ID 必须拒绝，不提供别名或重定向', (t) => {
  const f = fixture(t);
  for (const command of ['dynamic-code', 'unsafe-html', 'target-blank', 'form-labels', 'image-alt']) {
    assert.equal(gateRegistry.findByManualCommand(command), null);
    const result = spawnSync(
      process.execPath,
      [path.resolve('bin/repo-guard.js'), command],
      { cwd: f.root, encoding: 'utf8' },
    );
    assert.equal(result.status, EXIT_CODES.error);
    assert.match(result.stdout + result.stderr, /未知命令/);
  }
  for (const id of [
    'security.dynamic-code',
    'security.vue-unsafe-html',
    'security.vue-target-blank',
    'accessibility.vue-form-label',
    'accessibility.vue-image-alt',
  ]) {
    f.config.ci.gatePolicy.gates = {
      [id]: { mode: 'off', scope: 'all-files' },
    };
    assert.throws(
      () => validateCiGatePolicy(f.config, gateRegistry),
      /未知或非 CI 门禁/,
    );
  }
});

test('Node 后端通过唯一门禁执行动态代码规则，不默认开启前端分类', (t) => {
  const f = fixture(t);
  const config = normalizeProjectDocument({
    version: 2,
    project: {
      id: 'api',
      role: 'backend',
      stack: 'node',
      preset: 'node-typescript',
    },
  });
  assert.equal(config.checks.sourceSecurity.enabled, true);
  assert.equal(config.checks.sourceSecurity.dynamicCode.enabled, true);
  assert.equal(config.checks.sourceSecurity.dynamicCode.stringTimers, false);
  for (const group of [
    'htmlInjection',
    'inlineEventCode',
    'urlScheme',
    'newWindow',
    'crossWindowMessage',
  ])
    assert.equal(config.checks.sourceSecurity[group].enabled, false);
  f.write('runtime.js', 'eval(data);window.postMessage(data,"*")');
  const result = sourceSecurityGate.run({
    root: f.root,
    config,
    plan: sourceSecurityGate.plan({ files: ['runtime.js'] }),
  });
  assert.deepEqual(
    result.findings.map((item) => item.ruleId),
    ['security/no-eval'],
  );
});

test('统一门禁按规则、路径、行列使用精确审批，错误位置不能豁免', (t) => {
  const f = fixture(t);
  const date = (days) => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  for (const [file, source, rule, column] of [
    ['a.js', 'eval(data)', 'security/no-eval', 1],
    ['a.vue', '<template><div v-html="data"/></template>', 'vue/no-v-html', 16],
    [
      'b.vue',
      '<template><a target="_blank">x</a></template>',
      'vue/target-blank-security',
      14,
    ],
  ]) {
    f.write(file, source);
    const entry = {
      id: 'reviewed-source',
      rule,
      path: file,
      line: 1,
      column,
      reason: '经过审查的临时例外',
      owner: 'dev',
      approvedBy: 'reviewer',
      ticket: 'SEC-1',
      createdOn: date(-1),
      expiresOn: date(10),
    };
    f.config.repository.exceptions.entries = [entry];
    const approved = f.run([file]);
    assert.equal(approved.status, 'passed', JSON.stringify(approved));
    assert.equal(approved.metrics.approvedExceptions, 1);
    f.config.repository.exceptions.entries = [{ ...entry, column: column + 1 }];
    assert.equal(f.run([file]).status, 'violation');
  }
});
