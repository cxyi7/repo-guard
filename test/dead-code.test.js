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
import { DEFAULT_DEAD_CODE_CONFIG } from '../src/config/defaults.js';
import {
  initializeDeadCodeBaseline,
  pruneDeadCodeBaseline,
} from '../src/gates/quality/dead-code-baseline-management.js';
import { runDeadCodeGate } from '../src/gates/quality/dead-code-gate.js';
import { executeKnipAnalysis } from '../src/integrations/knip/execution.js';
import { parseKnipJsonReport } from '../src/integrations/knip/report.js';
import {
  compareBaselineExpansion,
  compareDeadCodeDebt,
  createDeadCodeBaseline,
  parseDeadCodeBaseline,
} from '../src/policies/dead-code-baseline.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function issue(name = 'unusedValue', file = 'src/unused.js') {
  return { type: 'exports', file, name, line: 2, col: 14 };
}

function report(issues) {
  const groups = new Map();
  for (const item of issues) {
    const group = groups.get(item.file) ?? { file: item.file };
    group[item.type] = [...(group[item.type] ?? []), {
      name: item.name,
      line: item.line,
      col: item.col,
    }];
    groups.set(item.file, group);
  }
  return { issues: [...groups.values()] };
}

function config(extra = {}) {
  return {
    ...DEFAULT_DEAD_CODE_CONFIG,
    enabled: true,
    issueTypes: [...DEFAULT_DEAD_CODE_CONFIG.issueTypes],
    ...extra,
  };
}

function createFixture() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'dead-code-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'dead-code-fixture',
    version: '1.0.0',
    type: 'module',
    devDependencies: { knip: '6.31.0' },
  }, null, 2)}\n`);
  const packageRoot = path.join(root, 'node_modules', 'knip');
  mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({
    name: 'knip',
    version: '6.31.0',
    type: 'module',
    bin: { knip: 'bin/knip.js' },
  }, null, 2)}\n`);
  writeFileSync(path.join(packageRoot, 'bin', 'knip.js'), [
    "import { existsSync, readFileSync } from 'node:fs';",
    "const include = process.argv[process.argv.indexOf('--include') + 1] ?? '';",
    "const requiredDependencyTypes = ['dependencies', 'devDependencies', 'optionalPeerDependencies'];",
    "if (!requiredDependencyTypes.every((type) => include.split(',').includes(type))) {",
    "  process.stderr.write('dependency issue types are incomplete');",
    "  process.exit(2);",
    "}",
    "const result = existsSync('knip-result.json')",
    "  ? readFileSync('knip-result.json', 'utf8')",
    "  : JSON.stringify({ issues: [] });",
    'process.stdout.write(result);',
    "const configurationHintCount = existsSync('knip-hint.txt') ? 1 : 0;",
    "process.stdout.write(`\\n@@REPO_GUARD_KNIP_METADATA@@${JSON.stringify({ configurationHintCount })}\\n`);",
    "process.exit(result.includes('\\\"issues\\\":[]') && configurationHintCount === 0 ? 0 : 1);",
    '',
  ].join('\n'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'main.js'), 'export const main = true;\n');
  return root;
}

function writeReport(root, issues) {
  writeFileSync(path.join(root, 'knip-result.json'), JSON.stringify(report(issues)));
}

function gateContext(root, deadCode, extra = {}) {
  return {
    root,
    config: { deadCode },
    changes: { entries: [] },
    logger: { info() {} },
    ...extra,
  };
}

test('解析 Knip 6 JSON 并拒绝仓库外路径', () => {
  const output = JSON.stringify({ issues: [{
    file: 'src/main.ts',
    exports: [{ name: 'unused', line: 1, col: 14 }],
    devDependencies: [{ name: 'legacy-package' }],
  }] });
  assert.deepEqual(parseKnipJsonReport(output, ['exports', 'dependencies']), [
    { type: 'exports', file: 'src/main.ts', name: 'unused', line: 1, col: 14 },
    { type: 'dependencies', file: 'src/main.ts', name: 'legacy-package' },
  ]);
  assert.throws(
    () => parseKnipJsonReport(
      JSON.stringify({ issues: [{ file: '../outside.ts', files: [{ name: 'outside' }] }] }),
      ['files'],
    ),
    /仓库外路径/,
  );
});

test('通过消费项目的 Knip CLI 执行严格模式门禁', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeReport(root, [issue()]);

  const analysis = await executeKnipAnalysis({ root, config: config() });
  assert.equal(analysis.setup.version, '6.31.0');
  assert.equal(analysis.issues[0].name, 'unusedValue');
  const result = await runDeadCodeGate(gateContext(root, config()));
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'dead-code/exports');
});

test('配置提示导致门禁失败，不能生成可信的无问题结论', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeReport(root, [issue()]);
  writeFileSync(path.join(root, 'knip-hint.txt'), 'Unused configuration entry');

  await assert.rejects(
    () => runDeadCodeGate(gateContext(root, config())),
    /配置提示/,
  );
});

test('基线指纹识别新增、已解决问题，并支持 Git 重命名比较', () => {
  const original = createDeadCodeBaseline([issue()], DEFAULT_DEAD_CODE_CONFIG.issueTypes);
  const parsed = parseDeadCodeBaseline(
    JSON.parse(JSON.stringify(original)),
    DEFAULT_DEAD_CODE_CONFIG.issueTypes,
  );
  const changed = compareDeadCodeDebt([issue(), issue('newExport')], parsed);
  assert.equal(changed.additions.length, 1);
  assert.equal(changed.resolved.length, 0);
  assert.equal(compareDeadCodeDebt([], parsed).resolved.length, 1);

  const renamed = createDeadCodeBaseline(
    [issue('unusedValue', 'src/renamed.js')],
    DEFAULT_DEAD_CODE_CONFIG.issueTypes,
  );
  assert.equal(compareBaselineExpansion(renamed, original, [{
    oldPath: 'src/unused.js',
    path: 'src/renamed.js',
  }]).length, 0);
  assert.throws(() => parseDeadCodeBaseline({
    ...JSON.parse(JSON.stringify(original)),
    entries: [{ ...original.entries[0], name: 'tampered' }],
  }, DEFAULT_DEAD_CODE_CONFIG.issueTypes), /fingerprint/);
});

test('noRegression 同时校验当前结果和基准提交，拒绝扩大历史债务', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const deadCode = config({ mode: 'noRegression' });
  const baselinePath = path.join(root, deadCode.baselineFile);
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  const firstIssue = issue();
  writeReport(root, [firstIssue]);
  writeFileSync(baselinePath, `${JSON.stringify(
    createDeadCodeBaseline([firstIssue], deadCode.issueTypes), null, 2,
  )}\n`);
  git(root, ['add', 'package.json', 'src/main.js', deadCode.baselineFile]);
  git(root, ['commit', '-m', 'baseline']);
  const base = git(root, ['rev-parse', 'HEAD']);
  assert.equal((await runDeadCodeGate(gateContext(root, deadCode))).status, 'passed');
  await assert.rejects(
    () => runDeadCodeGate(gateContext(root, deadCode, { environment: 'pre-push' })),
    /Git 基准提交/,
  );

  const addedIssue = issue('newExport');
  writeReport(root, [firstIssue, addedIssue]);
  writeFileSync(baselinePath, `${JSON.stringify(
    createDeadCodeBaseline([firstIssue, addedIssue], deadCode.issueTypes), null, 2,
  )}\n`);
  const result = await runDeadCodeGate(gateContext(root, deadCode, {
    revision: { base },
  }));
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.some(({ ruleId }) => ruleId === 'dead-code/baseline-expanded'), true);
  assert.match(readFileSync(baselinePath, 'utf8'), /newExport/);
});

test('基线初始化拒绝覆盖，裁剪只允许删除已解决债务', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const deadCode = config({ mode: 'noRegression' });
  writeReport(root, [issue()]);
  writeFileSync(path.join(root, 'repo-guard.config.json'), `${JSON.stringify({
    version: 1,
    notification: { enabled: false },
    deadCode,
    rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    exclusions: [],
  }, null, 2)}\n`);

  const initialized = spawnSync(process.execPath, [
    CLI_PATH,
    'dead-code-baseline',
    'init',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /登记 1 项历史问题/);
  await assert.rejects(
    () => initializeDeadCodeBaseline(root, deadCode),
    /拒绝覆盖/,
  );
  git(root, ['add', 'package.json', 'src/main.js', deadCode.baselineFile]);
  git(root, ['commit', '-m', 'baseline']);

  writeReport(root, [issue(), issue('newExport')]);
  await assert.rejects(
    () => pruneDeadCodeBaseline(root, deadCode),
    /新增问题/,
  );
  writeReport(root, []);
  const pruned = await pruneDeadCodeBaseline(root, deadCode);
  assert.deepEqual(
    { before: pruned.before, after: pruned.after, changed: pruned.changed },
    { before: 1, after: 0, changed: true },
  );
});
