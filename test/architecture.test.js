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
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildArchitectureAiRepairInstructions,
  createDependencyCruiserConfig,
  detectProjectArchitectureSetup,
  formatArchitectureReport,
  parseArchitectureReport,
  runArchitectureGate,
  validateArchitectureSetup,
} from '../src/architecture-runner.js';
import {
  ensureArchitecturePolicy,
  isArchitecturePolicyCurrent,
} from '../src/architecture-policy.js';
import { runPrePush } from '../src/commands/pre-push.js';
import { runDoctor } from '../src/commands/doctor.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function architectureConfig(extra = {}) {
  return {
    enabled: true,
    timeoutMs: 30000,
    sourcePaths: ['src'],
    tsConfig: null,
    exclude: '(?:^|/)dist/',
    rules: [
      {
        name: 'no-circular',
        severity: 'error',
        from: { path: '^src/' },
        to: { circular: true },
      },
    ],
    ...extra,
  };
}

function createFixture({ enabled = true } = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'architecture-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'main.js'), "import './shared.js';\n");
  writeFileSync(path.join(root, 'src', 'shared.js'), 'export const value = 1;\n');
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n');
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'architecture-fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  const dependencyRoot = path.join(root, 'node_modules', 'dependency-cruiser');
  mkdirSync(path.join(dependencyRoot, 'bin'), { recursive: true });
  writeFileSync(
    path.join(dependencyRoot, 'package.json'),
    `${JSON.stringify({
      name: 'dependency-cruiser',
      version: '17.3.2',
      type: 'module',
      main: 'index.js',
      exports: { '.': { import: './index.js' } },
      bin: { depcruise: 'bin/dependency-cruise.mjs' },
    }, null, 2)}\n`,
  );
  writeFileSync(path.join(dependencyRoot, 'index.js'), 'export default {};\n');
  writeFileSync(
    path.join(dependencyRoot, 'bin', 'dependency-cruise.mjs'),
    [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "const configIndex = process.argv.indexOf('--config');",
      "const config = JSON.parse(readFileSync(process.argv[configIndex + 1], 'utf8'));",
      "writeFileSync('architecture-generated-config.json', `${JSON.stringify(config, null, 2)}\\n`);",
      "const report = existsSync('architecture-result.json')",
      "  ? JSON.parse(readFileSync('architecture-result.json', 'utf8'))",
      "  : { modules: [{ source: 'src/main.js' }], summary: { totalCruised: 1, violations: [] } };",
      'process.stdout.write(JSON.stringify(report));',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      architecture: { ...architectureConfig(), enabled },
      notification: { enabled: false },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

function writeReport(root, violations) {
  writeFileSync(
    path.join(root, 'architecture-result.json'),
    `${JSON.stringify({
      modules: [{ source: 'src/main.js' }, { source: 'src/shared.js' }],
      summary: { totalCruised: 2, violations },
    }, null, 2)}\n`,
  );
}

test('detects dependency-cruiser and generates a repo-owned configuration', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const setup = validateArchitectureSetup(root, architectureConfig());
  assert.equal(setup.dependencyCruiser.version, '17.3.2');
  assert.equal(setup.tsConfig, 'tsconfig.json');
  assert.equal(detectProjectArchitectureSetup(root, architectureConfig()).ready, true);
  assert.throws(
    () => validateArchitectureSetup(
      root,
      architectureConfig({ sourcePaths: ['--output-type'] }),
    ),
    /cannot start with/,
  );
  assert.deepEqual(createDependencyCruiserConfig(architectureConfig(), setup), {
    forbidden: architectureConfig().rules,
    options: {
      doNotFollow: { path: 'node_modules' },
      exclude: { path: '(?:^|/)dist/' },
      tsConfig: { fileName: 'tsconfig.json' },
    },
  });
});

test('parses dependency-cruiser JSON and blocks error violations', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeReport(root, [{
    type: 'dependency',
    from: 'src/main.js',
    to: 'src/shared.js',
    rule: { name: 'no-circular', severity: 'error' },
    cycle: ['src/shared.js', 'src/main.js'],
  }]);

  assert.equal(runArchitectureGate({ root, config: architectureConfig() }), 1);
  const generated = JSON.parse(
    readFileSync(path.join(root, 'architecture-generated-config.json'), 'utf8'),
  );
  assert.equal(generated.forbidden[0].name, 'no-circular');
  assert.equal(generated.options.tsConfig.fileName, 'tsconfig.json');
  assert.equal(parseArchitectureReport(JSON.stringify({
    modules: [],
    summary: { totalCruised: 0, violations: [] },
  })).violations.length, 0);
});

test('builds standalone AI repair instructions and formats dependency-cruiser 17 cycles', () => {
  const root = path.resolve('fixture');
  const violations = [
    {
      type: 'cycle',
      from: 'src/api/message.js',
      to: 'src/lib/axios.js',
      rule: { name: 'no-circular', severity: 'error' },
      cycle: [
        { name: 'src/lib/axios.js', dependencyTypes: ['import'] },
        { name: 'src/store/user.js', dependencyTypes: ['import'] },
        { name: 'src/api/message.js', dependencyTypes: ['import'] },
      ],
    },
    {
      type: 'dependency',
      from: 'src/main.js',
      to: '/@/missing.js',
      rule: { name: 'no-unresolved', severity: 'error' },
    },
    {
      type: 'dependency',
      from: 'src/optional.js',
      to: 'src/legacy.js',
      rule: { name: 'legacy-review', severity: 'warn' },
    },
  ];

  const report = formatArchitectureReport({ modulesCruised: 4, violations }, '17.4.3');
  const instructions = buildArchitectureAiRepairInstructions({ root, violations });

  assert.match(
    report,
    /cycle: src\/lib\/axios\.js -> src\/store\/user\.js -> src\/api\/message\.js/,
  );
  assert.doesNotMatch(report, /\[object Object\]/);
  assert.match(instructions, /1\. 请修复依赖架构规则 no-circular 的违规/);
  assert.match(instructions, /项目根目录：.+fixture/);
  assert.match(instructions, /完整循环链路：src\/api\/message\.js -> src\/lib\/axios\.js/);
  assert.match(instructions, /2\. 请修复依赖架构规则 no-unresolved 的违规/);
  assert.match(instructions, /architecture\.tsConfig/);
  assert.doesNotMatch(instructions, /legacy-review/);
  assert.match(instructions, /npm run guard:architecture/);
  assert.match(instructions, /不得关闭、删除、降级或忽略架构规则/);
});

test('reports warnings without weakening the hard error gate', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeReport(root, [{
    type: 'dependency',
    from: 'src/main.js',
    to: 'src/shared.js',
    rule: { name: 'review-boundary', severity: 'warn' },
  }]);

  assert.equal(runArchitectureGate({ root, config: architectureConfig() }), 0);
});

test('exposes architecture through CLI and pre-push', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  ensureArchitecturePolicy(root, architectureConfig());

  const cliResult = spawnSync(process.execPath, [CLI_PATH, 'architecture'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /architecture passed/);
  assert.equal(spawnSync('git', ['config', 'user.name', 'repo-guard test'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 'repo-guard@example.invalid'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-m', 'fixture'], { cwd: root }).status, 0);
  assert.equal(await runPrePush(root), 0);
});

test('maintains an idempotent AGENTS architecture policy', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\n');

  const first = ensureArchitecturePolicy(root, architectureConfig());
  const content = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const second = ensureArchitecturePolicy(root, architectureConfig());

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.match(content, /repo-guard:architecture-policy:start/);
  assert.match(content, /no-circular/);
  assert.equal(isArchitecturePolicyCurrent(content, architectureConfig()), true);
});

test('doctor repairs and validates the enabled architecture gate', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(await runDoctor(root, { fix: true }), 0);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:architecture-policy:start/,
  );
  assert.equal(await runDoctor(root), 0);
});
