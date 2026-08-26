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
import {
  runBuildGate,
} from '../src/gates/quality/build-gate.js';
import { detectProjectBuildSetup } from '../src/gates/quality/build-setup.js';
import {
  initializeBuildArtifactBaseline,
  pruneBuildArtifactBaseline,
} from '../src/gates/quality/build-artifact-baseline-management.js';
import { validateBuildSetup } from '../src/integrations/npm/build.js';
import { validateExecutionGateConfiguration } from '../src/config/execution-gate-validation.js';
import { runPrePush } from '../src/orchestration/pre-push/runner.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function commitFixture(root) {
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
}

function buildConfig(extra = {}) {
  return {
    enabled: true,
    script: 'build',
    timeoutMs: 30000,
    ...extra,
  };
}

function createFixture({ enabled = true } = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'build-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'build-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'node build.mjs' },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'build.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "appendFileSync('build-calls.log', 'build\\n');",
      "if (existsSync('fail-build')) process.exitCode = 7;",
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      build: { ...buildConfig(), enabled },
      notification: { enabled: false },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('detects and validates the consuming project build script', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(validateBuildSetup(root, buildConfig()), {
    command: 'node build.mjs',
    cleanCommand: null,
  });
  assert.equal(detectProjectBuildSetup(root, buildConfig()).ready, true);
  assert.throws(
    () => validateBuildSetup(root, buildConfig({ script: 'missing' })),
    /要求 package.json 提供脚本“missing”/,
  );
});

function normalizedArtifactBuild(artifactBudget) {
  return validateExecutionGateConfiguration({
    build: {
      enabled: true,
      script: 'build',
      timeoutMs: 30000,
      artifactBudget,
    },
  }, 'repo-guard.config.json').build;
}

function createArtifactFixture(buildSource) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'build-artifact-'));
  git(root, ['init']);
  writeFileSync(path.join(root, '.gitignore'), 'dist/\nunpackage/\n');
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'build-artifact-fixture',
    version: '1.0.0',
    type: 'module',
    scripts: { build: 'node build.mjs', clean: 'node clean.mjs' },
  }, null, 2)}\n`);
  writeFileSync(path.join(root, 'build.mjs'), buildSource);
  writeFileSync(
    path.join(root, 'clean.mjs'),
    "import { rmSync } from 'node:fs';\nrmSync('dist', { recursive: true, force: true });\n",
  );
  return root;
}

test('checks Vite entry assets, compression, source maps, and stale output', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist/.vite', { recursive: true });",
    "mkdirSync('dist/assets', { recursive: true });",
    "writeFileSync('dist/assets/main.js', 'console.log(1);'.repeat(20));",
    "writeFileSync('dist/assets/main.css', 'body{color:red}'.repeat(10));",
    "writeFileSync('dist/.vite/manifest.json', JSON.stringify({ entry: { file: 'assets/main.js', css: ['assets/main.css'], isEntry: true } }));",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const passingConfig = normalizedArtifactBuild({
    enabled: true,
    platform: 'pc',
    outputDirectory: 'dist',
    cleanScript: 'clean',
    pc: {
      analyzer: 'viteManifest',
      limits: {
        totalRawBytes: 10000,
        initialJsBrotliBytes: 1000,
        initialCssBrotliBytes: 1000,
        maxChunkCount: 2,
      },
    },
  });
  const passed = await runBuildGate({ root, config: passingConfig });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.metrics.maxChunkCount, 1);
  assert.ok(passed.metrics.initialJsBrotliBytes > 0);

  const failed = await runBuildGate({
    root,
    config: normalizedArtifactBuild({
      ...passingConfig.artifactBudget,
      cleanScript: 'clean',
      pc: {
        ...passingConfig.artifactBudget.pc,
        limits: { totalRawBytes: 10 },
      },
    }),
  });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.findings[0].ruleId, 'build-artifact/pc-totalRawBytes');

  writeFileSync(path.join(root, 'build.mjs'), [
    readFileSync(path.join(root, 'build.mjs'), 'utf8'),
    "writeFileSync('dist/assets/main.js.map', '{}');",
    '',
  ].join('\n'));
  const sourceMapResult = await runBuildGate({ root, config: passingConfig });
  assert.equal(sourceMapResult.status, 'violation');
  assert.equal(sourceMapResult.findings.some(({ ruleId }) => ruleId === 'build-artifact/pc-source-map'), true);
});

test('blocks build scripts that keep old output when no clean script is configured', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'ok');",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'old.js'), 'old');
  const result = await runBuildGate({
    root,
    config: normalizedArtifactBuild({
      enabled: true,
      platform: 'pc',
      outputDirectory: 'dist',
      pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
    }),
  });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'build-artifact/stale-output');
  assert.equal(existsSync(path.join(root, 'dist', '.repo-guard-build-sentinel')), false);
});

test('refuses to overwrite or remove a pre-existing stale-output sentinel', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'ok');",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  const sentinel = path.join(root, 'dist', '.repo-guard-build-sentinel');
  writeFileSync(sentinel, 'business-owned-file\n');

  await assert.rejects(
    runBuildGate({
      root,
      config: normalizedArtifactBuild({
        enabled: true,
        platform: 'pc',
        outputDirectory: 'dist',
        pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
      }),
    }),
    /已存在 repo-guard 清理探针同名文件/,
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'business-owned-file\n');
});

test('removes only its own stale-output sentinel when artifact cleaning is cancelled', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'ok');",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'old.js'), 'old');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runBuildGate({
      root,
      signal: controller.signal,
      config: normalizedArtifactBuild({
        enabled: true,
        platform: 'pc',
        outputDirectory: 'dist',
        cleanScript: 'clean',
        pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
      }),
    }),
    (error) => error.code === 'build/unexpected-clean-execution-failure',
  );
  assert.equal(existsSync(path.join(root, 'dist', '.repo-guard-build-sentinel')), false);
});

test('refuses to analyze a build output directory that contains tracked files', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'ok');",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'tracked.js'), 'tracked');
  git(root, ['add', '-f', 'dist/tracked.js']);
  await assert.rejects(
    runBuildGate({
      root,
      config: normalizedArtifactBuild({
        enabled: true,
        platform: 'pc',
        outputDirectory: 'dist',
        pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
      }),
    }),
    /包含 Git 已跟踪文件/,
  );
});

test('requires a configured clean script to remove every old artifact', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'new');",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'old.js'), 'old');
  writeFileSync(
    path.join(root, 'clean.mjs'),
    "import { rmSync } from 'node:fs';\nrmSync('dist/.repo-guard-build-sentinel', { force: true });\n",
  );
  const result = await runBuildGate({
    root,
    config: normalizedArtifactBuild({
      enabled: true,
      platform: 'pc',
      outputDirectory: 'dist',
      cleanScript: 'clean',
      pc: { analyzer: 'directory', limits: { totalRawBytes: 1000 } },
    }),
  });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'build-artifact/nonempty-output-after-clean');
});

test('calculates WeChat main and subpackage budgets and validates preload rules', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, rmSync, writeFileSync } from 'node:fs';",
    "rmSync('unpackage/dist/build/mp-weixin', { recursive: true, force: true });",
    "mkdirSync('unpackage/dist/build/mp-weixin/pagesA', { recursive: true });",
    "writeFileSync('unpackage/dist/build/mp-weixin/app.json', JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'pagesA', pages: ['page'] }], preloadRule: { 'pages/index': { packages: ['pagesA'] } } }));",
    "writeFileSync('unpackage/dist/build/mp-weixin/app.js', 'm'.repeat(30));",
    "writeFileSync('unpackage/dist/build/mp-weixin/pagesA/page.js', 's'.repeat(40));",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = normalizedArtifactBuild({
    enabled: true,
    platform: 'miniProgram',
    outputDirectory: 'unpackage/dist/build/mp-weixin',
    miniProgram: {
      limits: {
        mainPackageBytes: 1000,
        defaultSubPackageBytes: 1000,
        totalPackageBytes: 2000,
        maxPreloadBytes: 100,
      },
      subPackages: [{ root: 'pagesA', maxBytes: 100 }],
      expectedSubPackages: ['pagesA'],
    },
  });
  const passed = await runBuildGate({ root, config });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.metrics.maxPreloadBytes, 40);

  const failed = await runBuildGate({
    root,
    config: normalizedArtifactBuild({
      ...config.artifactBudget,
      miniProgram: {
        ...config.artifactBudget.miniProgram,
        limits: {
          ...config.artifactBudget.miniProgram.limits,
          defaultSubPackageBytes: 20,
        },
        subPackages: [],
      },
    }),
  });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.findings.some(({ ruleId }) => ruleId === 'build-artifact/mini-program-subpackage-bytes'), true);
});

test('allows existing PC debt but blocks growth and only prunes the artifact baseline', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'x'.repeat(40));",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const strictConfig = normalizedArtifactBuild({
    enabled: true,
    platform: 'pc',
    outputDirectory: 'dist',
    cleanScript: 'clean',
    pc: { analyzer: 'directory', limits: { totalRawBytes: 10 } },
  });
  assert.equal((await runBuildGate({ root, config: strictConfig })).status, 'violation');
  const baselineConfig = normalizedArtifactBuild({
    ...strictConfig.artifactBudget,
    mode: 'baseline',
  });
  const initialized = initializeBuildArtifactBaseline(root, baselineConfig.artifactBudget);
  assert.equal(initialized.debtCount, 1);
  git(root, ['add', baselineConfig.artifactBudget.baselineFile]);
  const accepted = await runBuildGate({ root, config: baselineConfig });
  assert.equal(accepted.status, 'passed');
  assert.equal(accepted.metrics.baselineDebt, 1);

  writeFileSync(path.join(root, 'build.mjs'), [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'x'.repeat(60));",
    '',
  ].join('\n'));
  const growth = await runBuildGate({ root, config: baselineConfig });
  assert.equal(growth.status, 'violation');

  writeFileSync(path.join(root, 'dist', 'index.js'), 'x'.repeat(20));
  const pruned = pruneBuildArtifactBaseline(root, baselineConfig.artifactBudget);
  assert.equal(pruned.changed, true);
  const baseline = JSON.parse(readFileSync(
    path.join(root, baselineConfig.artifactBudget.baselineFile),
    'utf8',
  ));
  assert.equal(baseline.allowances['pc/totalRawBytes'], 20);
});

test('exposes explicit artifact baseline initialization through the CLI', async (context) => {
  const root = createArtifactFixture([
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    "writeFileSync('dist/index.js', 'x'.repeat(40));",
    '',
  ].join('\n'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const strictConfig = normalizedArtifactBuild({
    enabled: true,
    platform: 'pc',
    outputDirectory: 'dist',
    cleanScript: 'clean',
    pc: { analyzer: 'directory', limits: { totalRawBytes: 10 } },
  });
  await runBuildGate({ root, config: strictConfig });
  writeFileSync(path.join(root, 'repo-guard.config.json'), `${JSON.stringify({
    version: 1,
    build: {
      ...strictConfig,
      artifactBudget: { ...strictConfig.artifactBudget, mode: 'baseline' },
    },
    notification: { enabled: false },
    rules: [{ pattern: '**', category: '测试项目', level: 'audit' }],
  }, null, 2)}\n`);

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, 'build-artifact-baseline', 'init'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /构建产物基线已初始化/);
  assert.equal(existsSync(path.join(root, '.repo-guard', 'build-artifact-baseline.json')), true);
});

test('runs the consuming project build script and blocks failures', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const passed = await runBuildGate({ root, config: buildConfig() });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.diagnostics.some(({ message }) => message.includes('build-fixture')), true);
  writeFileSync(path.join(root, 'fail-build'), 'fail\n');
  const failed = await runBuildGate({ root, config: buildConfig() });
  assert.equal(failed.status, 'violation');
  assert.equal(failed.diagnostics.some(({ message }) => message.includes('build-fixture')), true);
  assert.equal(
    readFileSync(path.join(root, 'build-calls.log'), 'utf8'),
    'build\nbuild\n',
  );
});

test('exposes build through CLI and runs it from pre-push', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const cliResult = spawnSync(process.execPath, [CLI_PATH, 'build'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /构建已通过/);
  commitFixture(root);
  assert.equal(await runPrePush(root), 0);
  assert.equal(
    readFileSync(path.join(root, 'build-calls.log'), 'utf8'),
    'build\nbuild\n',
  );
});
