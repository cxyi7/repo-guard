import { runArchitectureGate } from '../../src/gates/quality/architecture-gate.js';
import { executeKnipAnalysis } from '../../src/integrations/knip/execution.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createProjectDocument,
  normalizeProjectDocument,
} from '../../src/config/project-configuration.js';
import { createStarterConfig } from '../../src/orchestration/setup/config-management.js';
import { getFrontendToolRequirements } from '../../src/profiles/frontend-tool-requirements.js';
import { inspectDependencyToolReadiness } from '../../src/gates/repository/dependency-tool-readiness.js';
import { runEslintFiles } from '../../src/gates/quality/eslint-gate.js';
import { runPrettierFiles } from '../../src/gates/quality/prettier-gate.js';
import { runTypeCheckGate } from '../../src/gates/quality/typecheck-gate.js';
import { runBuildGate } from '../../src/gates/quality/build-gate.js';
import { runUnitTestGate } from '../../src/gates/testing/unit-test-gate.js';
import { createChangeSet } from '../../src/core/capability/gate-context.js';

const nodeProject = (preset) => ({
  id: 'api',
  role: 'backend',
  stack: 'node',
  preset,
});
function fixture(t, preset = 'node-typescript') {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-guard-node-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };
  const manifest = {
    name: 'node-audit',
    version: '1.0.0',
    type: 'module',
    devDependencies: {},
    scripts: {},
  };
  const link = (name, directory = path.resolve('node_modules', name)) => {
    const target = path.join(root, 'node_modules', name);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(directory, target, 'junction');
    manifest.devDependencies[name] = JSON.parse(
      readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ).version;
    write('package.json', manifest);
  };
  write('package.json', manifest);
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  const config = createProjectDocument(nodeProject(preset));
  // 各真实工具专项只准备被测工具；新建全开默认值由下方身份测试独立验证。
  for (const [feature, check] of Object.entries(config.checks)) {
    if (!['eslint', 'prettier', 'sourceSecurity', 'maxFileLines', 'filePlacement'].includes(feature)) check.enabled = false;
  }
  config.repository.dependencyPolicy.packageManager.checkInstalledVersion = false;
  config.repository.dependencyPolicy.packageManager.requireVersionDeclaration = false;
  return { root, write, link, manifest, config };
}

test('Node 两种预设不带前端治理，ESLint 需求与真实预设一致', () => {
  for (const preset of ['node-javascript', 'node-typescript']) {
    const config = createProjectDocument(nodeProject(preset));
    const tools = getFrontendToolRequirements(config).map((item) => item.name);
    assert.ok(tools.includes('@eslint/js'));
    assert.equal(
      tools.includes('typescript-eslint'),
      preset === 'node-typescript',
    );
    assert.ok(
      !tools.some((name) =>
        ['vue', 'vue-tsc', 'eslint-plugin-vue', '@lhci/cli'].includes(name),
      ),
    );
    for (const key of [
      'stylelint',
      'lighthouse',
      'asyncResourceCleanup',
      'imageAssets',
      'unusedImageAssets',
    ])
      assert.equal(config.checks[key].enabled, false, key);
    assert.equal(config.checks.sourceSecurity.dynamicCode.enabled, true);
    assert.equal(config.checks.sourceSecurity.htmlInjection.enabled, false);
    assert.equal(
      createStarterConfig({
        project: nodeProject(preset),
        stylelintEnabled: true,
      }).checks.stylelint.governance.enabled,
      false,
    );
    for (const key of ['lighthouse', 'asyncResourceCleanup'])
      assert.throws(
        () =>
          normalizeProjectDocument({
            ...config,
            checks: { ...config.checks, [key]: { enabled: true } },
          }),
        /仅适用于前端/,
      );
  }
});

for (const preset of ['node-javascript', 'node-typescript'])
  test(`真实 ${preset} ESLint 无需 Vue，Node 全局与错误均按原生配置检查`, async (t) => {
    const f = fixture(t, preset);
    for (const name of [
      'eslint',
      '@eslint/js',
      ...(preset.endsWith('typescript')
        ? ['typescript-eslint', 'typescript']
        : []),
    ])
      f.link(name);
    const extension = preset.endsWith('typescript') ? 'ts' : 'js';
    f.write(
      'eslint.config.mjs',
      'export default [{languageOptions:{globals:{process:"readonly"}}}];',
    );
    f.write(
      `server/main.${extension}`,
      'export const port = process.env.PORT; debugger;\n',
    );
    const args = {
      root: f.root,
      files: [`server/main.${extension}`],
      ...f.config.checks.eslint,
      fix: false,
      descriptor: f.config.project,
    };
    assert.equal((await runEslintFiles(args)).status, 'violation');
    f.write(
      `server/main.${extension}`,
      'export const port = process.env.PORT;\n',
    );
    assert.equal((await runEslintFiles(args)).status, 'passed');
    assert.equal(existsSync(path.join(f.root, 'node_modules/vue')), false);
  });

test('Node mts 与 cts 入口参与真实工具就绪配置加载', async (t) => {
  const f = fixture(t);
  for (const name of [
    'eslint',
    '@eslint/js',
    'typescript-eslint',
    'typescript',
  ])
    f.link(name);
  f.config.checks.prettier.enabled = false;
  f.write('eslint.config.mjs', 'export default [{}];');
  for (const extension of ['mts', 'cts']) {
    f.write(`server/main.${extension}`, 'export const port = 3000;');
    const result = await inspectDependencyToolReadiness({
      root: f.root,
      config: f.config,
      files: [`server/main.${extension}`],
    });
    assert.ok(result.checkedConfigurations > 0);
  }
});

test('Prettier 使用项目配置的 YAML 目标加载真实配置', async (t) => {
  const f = fixture(t);
  f.link('prettier');
  f.config.checks.eslint.enabled = false;
  f.write('.prettierrc.json', { singleQuote: true });
  f.write('server/settings.yaml', 'port: 3000\n');
  const result = await inspectDependencyToolReadiness({
    root: f.root,
    config: f.config,
    files: ['server/settings.yaml'],
  });
  assert.ok(result.checkedConfigurations > 0);
});

test('Node 自定义目录的 Prettier 与 tsc 真正检出问题，修复后构建产物可运行', async (t) => {
  const f = fixture(t);
  f.link('prettier');
  f.link('typescript');
  f.write('.prettierrc.json', { singleQuote: true });
  f.write('server/value.ts', 'export const value: number = "wrong";\n');
  f.write('tsconfig.json', {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: [],
      outDir: 'output',
      skipLibCheck: false,
    },
    include: ['server/**/*.ts'],
  });
  const typeConfig = {
    enabled: true,
    timeoutMs: 30000,
    options: {
      tool: 'tsc',
      configFiles: ['tsconfig.json'],
      compilerOptions: { strict: true, noEmit: true },
    },
  };
  assert.equal(
    (await runTypeCheckGate({ root: f.root, config: typeConfig })).status,
    'violation',
  );
  f.write('server/value.ts', 'export const value:number=42');
  const prettierArgs = {
    root: f.root,
    files: ['server/value.ts'],
    requireConfig: true,
  };
  assert.equal(
    (await runPrettierFiles({ ...prettierArgs, fix: false })).status,
    'violation',
  );
  await runPrettierFiles({ ...prettierArgs, fix: true });
  assert.equal(
    (await runTypeCheckGate({ root: f.root, config: typeConfig })).status,
    'passed',
  );
  f.manifest.scripts.build =
    'node node_modules/typescript/bin/tsc -p tsconfig.json';
  f.write('package.json', f.manifest);
  const result = await runBuildGate({
    root: f.root,
    config: { ...f.config.checks.build, enabled: true },
  });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  const executed = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import assert from "node:assert/strict"; import {value} from "./output/value.js"; assert.equal(value,42);',
    ],
    { cwd: f.root, encoding: 'utf8' },
  );
  assert.equal(executed.status, 0, executed.stderr);
});

const vitestPath = path.resolve(
  'test/.tmp/node-audit-tools/node_modules/vitest',
);
test(
  'Node 真实 Vitest 测试失败与修复通过，不依赖前端测试目录',
  {
    skip:
      !existsSync(vitestPath) &&
      '需先在 test/.tmp/node-audit-tools 安装 Vitest 4.0.18',
  },
  async (t) => {
    const f = fixture(t, 'node-javascript');
    f.link('vitest', vitestPath);
    f.manifest.scripts['test:unit'] = 'node node_modules/vitest/vitest.mjs run';
    f.write('package.json', f.manifest);
    f.write('server/value.js', 'export const value = 2;');
    f.write(
      'server/value.test.js',
      'import {test,expect} from "vitest"; import {value} from "./value.js"; test("结果",()=>expect(value).toBe(1));',
    );
    const config = {
      ...f.config.checks.unitTest,
      enabled: true,
      coverage: f.config.checks.coverage,
      sourcePatterns: ['server/**/*.js'],
    };
    const args = {
      root: f.root,
      config,
      changes: createChangeSet({ source: 'manual', changes: [] }),
    };
    assert.equal((await runUnitTestGate(args)).status, 'violation');
    f.write('server/value.js', 'export const value = 1;');
    const result = await runUnitTestGate(args);
    assert.equal(result.status, 'passed', JSON.stringify(result));
  },
);

test(
  '已启用 Node 单元测试时工具就绪必须检查实际脚本存在',
  { skip: !existsSync(vitestPath) && '需先安装审查用 Vitest' },
  async (t) => {
    const f = fixture(t);
    f.link('vitest', vitestPath);
    for (const check of Object.values(f.config.checks)) check.enabled = false;
    f.config.checks.unitTest.enabled = true;
    f.config.checks.unitTest.script = 'verify:server';
    f.config.repository.dependencyPolicy.toolReadiness.checkConfigLoading = false;
    await assert.rejects(
      inspectDependencyToolReadiness({ root: f.root, config: f.config }),
      /verify:server/,
    );
    f.manifest.scripts['verify:server'] =
      'node node_modules/vitest/vitest.mjs run';
    f.write('package.json', f.manifest);
    assert.ok(
      (await inspectDependencyToolReadiness({ root: f.root, config: f.config }))
        .checkedTools > 0,
    );
  },
);


test('Node 后端真实依赖图检查循环，Knip 检查未使用导出', async t => {
  const f = fixture(t, 'node-javascript');
  for (const name of ['dependency-cruiser', 'knip', 'typescript']) f.link(name);
  f.write('server/a.js', 'import { b } from "./b.js"; export const a = () => b();');
  f.write('server/b.js', 'import { a } from "./a.js"; export const b = () => a();');
  const config = { ...f.config.checks.architecture, enabled: true, sourcePaths: ['server'], rules: [{ name: 'no-circular', severity: 'error', from: {}, to: { circular: true } }] };
  assert.equal(runArchitectureGate({ root: f.root, config }).status, 'violation');
  f.write('server/b.js', 'export const b = () => 1; export const unused = 2;');
  assert.equal(runArchitectureGate({ root: f.root, config }).status, 'passed');
  f.write('knip.json', { entry: ['server/a.js'], project: ['server/**/*.js'] });
  const deadCode = { ...f.config.checks.deadCode, enabled: true, issueTypes: ['exports', 'files'] };
  assert.ok((await executeKnipAnalysis({ root: f.root, config: deadCode })).issues.some(item => item.name === 'unused'));
  f.write('server/b.js', 'export const b = () => 1;');
  assert.deepEqual((await executeKnipAnalysis({ root: f.root, config: deadCode })).issues, []);
});
