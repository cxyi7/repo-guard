import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateConfigValue } from '../src/config/configuration-validation.js';
import { sendMutationTestFailureNotification } from '../src/gates/release/mutation-test-notification.js';
import {
  parseMutationReport,
  renderChineseMutationReport,
} from '../src/integrations/stryker/report.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function mutant(status, extra = {}) {
  return {
    id: '1',
    mutatorName: 'BooleanLiteral',
    replacement: 'false',
    status,
    location: {
      start: { line: 1, column: 20 },
      end: { line: 1, column: 24 },
    },
    ...extra,
  };
}

function mutationReport(status = 'Survived') {
  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60, break: 80 },
    files: {
      'src/answer.js': {
        source: 'export const answer = true;\n',
        mutants: [mutant(status, { statusReason: '<原始诊断>' })],
      },
    },
  };
}

function createFakeStryker(root) {
  const packageRoot = path.join(root, 'node_modules', '@stryker-mutator', 'core');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({
    name: '@stryker-mutator/core',
    version: '10.0.0',
    type: 'module',
    exports: {
      '.': './index.js',
      './package.json': './package.json',
    },
  }, null, 2)}\n`);
  writeFileSync(path.join(packageRoot, 'index.js'), [
    "import { existsSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    'export class Stryker {',
    '  constructor(options) { this.options = options; }',
    '  async runMutationTest() {',
    "    if (existsSync('fail-mutation')) throw 'fixture mutation failure';",
    "    writeFileSync('stryker-options.json', JSON.stringify(this.options), 'utf8');",
    "    const status = existsSync('pass-mutation') ? 'Killed' : 'Survived';",
    '    const report = {',
    "      schemaVersion: '1.0',",
    "      thresholds: existsSync('missing-break-threshold') ? { high: 80, low: 60 } : { high: 80, low: 60, break: 80 },",
    "      files: { 'src/answer.js': { source: 'export const answer = true;\\n', mutants: existsSync('empty-mutation') ? [] : [{",
    "        id: '1', mutatorName: 'BooleanLiteral', replacement: 'false', status,",
    '        location: { start: { line: 1, column: 20 }, end: { line: 1, column: 24 } },',
    '      }] } },',
    '    };',
    '    mkdirSync(path.dirname(this.options.jsonReporter.fileName), { recursive: true });',
    "    writeFileSync(this.options.jsonReporter.fileName, JSON.stringify(report), 'utf8');",
    '    if (this.options.htmlReporter) {',
    "      writeFileSync(this.options.htmlReporter.fileName, '<html>fixture</html>', 'utf8');",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'));
}

function createFixture() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'mutation-test-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  writeFileSync(path.join(root, '.gitignore'), 'reports/mutation/\n');
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'mutation-test-fixture',
    version: '1.0.0',
    type: 'module',
    scripts: {
      'build:mp-weixin': 'node build.mjs',
      'build:h5': 'node build.mjs',
    },
  }, null, 2)}\n`);
  writeFileSync(
    path.join(root, 'build.mjs'),
    "import { appendFileSync } from 'node:fs';\nappendFileSync('build-calls.log', 'build\\n');\n",
  );
  writeFileSync(path.join(root, 'stryker.config.json'), '{}\n');
  writeFileSync(path.join(root, 'repo-guard.config.json'), `${JSON.stringify({
    version: 1,
    notification: { enabled: false },
    mutationTest: {
      enabled: true,
      configFile: 'stryker.config.json',
      timeoutMs: 30000,
      reportsDirectory: 'reports/mutation',
      originalHtml: true,
      guardedBuilds: [
        {
          script: 'build:mp-weixin',
          packageScript: 'guard:build:mp-weixin',
          timeoutMs: 30000,
          notifyOnFailure: true,
        },
        {
          script: 'build:h5',
          packageScript: 'guard:build:h5',
          timeoutMs: 30000,
          notifyOnFailure: false,
        },
      ],
    },
    rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    exclusions: [],
  }, null, 2)}\n`);
  createFakeStryker(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

function runGuardedBuild(root, script = 'build:mp-weixin') {
  return spawnSync(process.execPath, [CLI_PATH, 'guarded-build', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('解析 Stryker 报告并生成转义后的中文报告', () => {
  const parsed = parseMutationReport(JSON.stringify(mutationReport()));
  assert.equal(parsed.metrics.score, 0);
  assert.equal(parsed.metrics.survived, 1);
  const html = renderChineseMutationReport(parsed);
  assert.match(html, /变异测试报告/);
  assert.match(html, /Stryker 原始诊断/);
  assert.match(html, /&lt;原始诊断&gt;/);
  assert.doesNotMatch(html, /<原始诊断>/);
});

test('拒绝不可信的报告状态、阈值和文件路径', () => {
  const unsupportedStatus = mutationReport('FutureStatus');
  assert.throws(() => parseMutationReport(JSON.stringify(unsupportedStatus)), /不支持的状态/);

  const invalidThreshold = mutationReport();
  invalidThreshold.thresholds.break = '80';
  assert.throws(() => parseMutationReport(JSON.stringify(invalidThreshold)), /必须介于 0 到 100/);

  const unsafePath = mutationReport();
  unsafePath.files['../outside.js'] = unsafePath.files['src/answer.js'];
  delete unsafePath.files['src/answer.js'];
  assert.throws(() => parseMutationReport(JSON.stringify(unsafePath)), /无效的仓库相对路径/);
});

test('校验多个受保护构建，并拒绝脚本递归和别名冲突', () => {
  const base = {
    version: 1,
    rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    exclusions: [],
  };
  const mutationTest = {
    enabled: true,
    guardedBuilds: [{
      script: 'build:h5',
      packageScript: 'guard:build:h5',
    }],
  };
  const normalized = validateConfigValue({ ...base, mutationTest }, 'repo-guard.config.json');
  assert.equal(normalized.mutationTest.guardedBuilds[0].timeoutMs, 300000);

  assert.throws(() => validateConfigValue({
    ...base,
    mutationTest: {
      ...mutationTest,
      guardedBuilds: [{
        script: 'guard:build:other',
        packageScript: 'guard:build:h5',
      }],
    },
  }, 'repo-guard.config.json'), /不得指向其他受保护构建脚本/);

  assert.throws(() => validateConfigValue({
    ...base,
    mutationTest: {
      ...mutationTest,
      guardedBuilds: [{
        script: 'build:h5',
        packageScript: 'guard:build:',
      }],
    },
  }, 'repo-guard.config.json'), /必须以 guard:build: 开头/);
});

test('变异得分未达门槛时阻断构建，通过后才运行任意已配置构建脚本', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const blocked = runGuardedBuild(root);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(existsSync(path.join(root, 'build-calls.log')), false);
  assert.equal(existsSync(path.join(root, 'reports', 'mutation', 'mutation.json')), true);
  assert.match(
    readFileSync(path.join(root, 'reports', 'mutation', 'mutation.html'), 'utf8'),
    /未通过/,
  );
  const options = JSON.parse(readFileSync(path.join(root, 'stryker-options.json'), 'utf8'));
  assert.equal(options.inPlace, false);
  assert.deepEqual(options.reporters, ['clear-text', 'progress', 'json', 'html']);
  assert.equal(options.configFile, 'stryker.config.json');
  assert.equal(options.jsonReporter.fileName, path.join('reports', 'mutation', 'mutation.json'));
  assert.equal(
    options.htmlReporter.fileName,
    path.join('reports', 'mutation', 'mutation-original.html'),
  );

  writeFileSync(path.join(root, 'pass-mutation'), 'pass\n');
  const passed = runGuardedBuild(root, 'build:h5');
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(readFileSync(path.join(root, 'build-calls.log'), 'utf8'), 'build\n');
});

test('执行失败前会删除旧报告，不能把旧结果误判为本次成功', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const reportDirectory = path.join(root, 'reports', 'mutation');
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(path.join(reportDirectory, 'mutation.json'), JSON.stringify(mutationReport('Killed')));
  writeFileSync(path.join(root, 'fail-mutation'), 'fail\n');

  const failed = runGuardedBuild(root);
  assert.notEqual(failed.status, 0);
  assert.equal(existsSync(path.join(reportDirectory, 'mutation.json')), false);
  assert.equal(existsSync(path.join(root, 'build-calls.log')), false);
});

test('拒绝不兼容的 Stryker 版本和已跟踪报告，且不执行构建', (context) => {
  const incompatibleRoot = createFixture();
  const trackedReportRoot = createFixture();
  context.after(() => {
    rmSync(incompatibleRoot, { recursive: true, force: true });
    rmSync(trackedReportRoot, { recursive: true, force: true });
  });

  const strykerPackagePath = path.join(
    incompatibleRoot,
    'node_modules',
    '@stryker-mutator',
    'core',
    'package.json',
  );
  const strykerPackage = JSON.parse(readFileSync(strykerPackagePath, 'utf8'));
  strykerPackage.version = '9.0.0';
  writeFileSync(strykerPackagePath, `${JSON.stringify(strykerPackage, null, 2)}\n`);
  const incompatible = runGuardedBuild(incompatibleRoot);
  assert.notEqual(incompatible.status, 0);
  assert.match(`${incompatible.stdout}\n${incompatible.stderr}`, /仅支持 @stryker-mutator\/core 10\.x/);
  assert.equal(existsSync(path.join(incompatibleRoot, 'build-calls.log')), false);

  const reportPath = path.join(trackedReportRoot, 'reports', 'mutation', 'mutation.html');
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, '不得覆盖\n');
  git(trackedReportRoot, ['add', '-f', 'reports/mutation/mutation.html']);
  git(trackedReportRoot, ['commit', '-m', 'track report fixture']);
  const tracked = runGuardedBuild(trackedReportRoot);
  assert.notEqual(tracked.status, 0);
  assert.match(`${tracked.stdout}\n${tracked.stderr}`, /不得覆盖已被 Git 跟踪的报告/);
  assert.equal(readFileSync(reportPath, 'utf8'), '不得覆盖\n');
  assert.equal(existsSync(path.join(trackedReportRoot, 'build-calls.log')), false);
});

test('没有可评分变异时阻断构建，避免空范围得到虚假的满分', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'empty-mutation'), 'empty\n');

  const blocked = runGuardedBuild(root);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(existsSync(path.join(root, 'build-calls.log')), false);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /没有可评分的变异/);
  const html = readFileSync(path.join(root, 'reports', 'mutation', 'mutation.html'), 'utf8');
  assert.match(html, /未通过/);
  assert.match(html, /没有可评分的变异，不能判定为通过/);
});

test('没有配置 thresholds.break 时阻断构建并在中文报告中说明原因', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'missing-break-threshold'), 'missing\n');

  const blocked = runGuardedBuild(root);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(existsSync(path.join(root, 'build-calls.log')), false);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /未配置 thresholds\.break/);
  const html = readFileSync(path.join(root, 'reports', 'mutation', 'mutation.html'), 'utf8');
  assert.match(html, /未通过/);
  assert.match(html, /未配置硬门槛，不能判定为通过/);
});

test('失败通知复用企业微信配置，并在受管流水线中避免重复发送', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const config = {
    notification: { enabled: true },
    ci: { pipeline: { notifications: false } },
  };
  const build = { script: 'build:mp-weixin', notifyOnFailure: true };
  const result = {
    summary: '变异测试执行失败',
    metrics: {},
    artifacts: [],
  };
  const environment = {
    REPO_GUARD_WECOM_WEBHOOK:
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture-key',
    REPO_GUARD_MENTION_MOBILES: '13800138000',
  };
  const send = async (...argumentsList) => calls.push(argumentsList);

  assert.equal(await sendMutationTestFailureNotification({
    root, config, build, result, environment, send,
  }), 'sent');
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /变异测试未通过，构建已中断/);
  assert.match(calls[0][1], /构建脚本：build:mp-weixin/);
  assert.match(calls[0][1], /变异得分：未生成/);

  config.ci.pipeline.notifications = true;
  assert.equal(await sendMutationTestFailureNotification({
    root,
    config,
    build,
    result,
    environment: { ...environment, GITLAB_CI: 'true' },
    send,
  }), 'managed-pipeline');
  assert.equal(calls.length, 1);
});
