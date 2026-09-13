import { loadUiTokenManifest } from '../../src/integrations/ui-tokens/manifest.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { createProjectDocument, normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { inspectPathNaming } from '../../src/policies/path-naming.js';
import { synchronizeFunctionDocumentationContent } from '../../src/policies/function-documentation.js';
import { functionDocumentationGate } from '../../src/gates/quality/function-documentation-gate.js';
import { runArchitectureGate } from '../../src/gates/quality/architecture-gate.js';
import { gateResultToExitCode } from '../../src/core/result/exit-code.js';
import { inspectFilePlacement } from '../../src/policies/file-placement.js';
import { matchMaxFileLineRule } from '../../src/policies/max-file-lines.js';
import { runQualityExecution } from '../../src/orchestration/pre-commit/quality-runner.js';
import { spawnSync } from 'node:child_process';

const project = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };
const config = createProjectDocument(project);
const docs = config.checks.functionDocs;
function fixture(t) {
  const base = path.join(process.cwd(), 'test/.tmp'); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'maintenance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, name, content) { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); return file; }

test('前端初始化写入维护默认值，既有配置不改写，后端独立启用', () => {
  for (const name of ['filePlacement', 'maxFileLines', 'pathNaming', 'architecture', 'asyncResourceCleanup', 'functionDocs', 'fileHeader']) assert.equal(config.checks[name].enabled, true, name);
  assert.equal(config.checks.deadCode.enabled, true);
  assert.equal(config.checks.architecture.rules.some((rule) => rule.name === 'no-package-internals'), false);
  assert.equal(config.repository.codePlacement.enabled, false);
  assert.equal(normalizeProjectDocument({ version: 2, project }).checks.pathNaming.enabled, false);
  const schema = JSON.parse(readFileSync('config.schema.json'));
  const ajv = new Ajv({ strict: false }); const validate = ajv.compile(schema);
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  assert.equal(createProjectDocument({ id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' }).checks.pathNaming.enabled, true);
});

test('默认路径接受多段类型文件名并拒绝大写文件、目录和扩展名', () => {
  const result = inspectPathNaming({ config: config.checks.pathNaming,
    files: ['src/types/order.types.ts', 'src/types/order.d.ts', 'src/order-list.vue', 'src/Order.vue', 'src/MyDir/good.ts', 'src/styles/main.SCSS', 'outside/Bad.ts'] });
  assert.equal(result.violations.length, 3);
  assert.ok(result.violations.some((finding) => finding.issue === 'path-naming/uppercase-extension'));
});

test('归位规则区分业务 TS 与专用类型，所有分类行数在正确目录生效', () => {
  const good = ['src/tests/order.test.ts', 'src/types/order.types.ts', 'src/types/order.d.ts', 'styles/main.scss', 'src/api/order.ts'];
  const bad = ['tests/order.test.ts', 'src/api/order.types.ts', 'src/order.d.ts', 'src/styles/main.css'];
  const result = inspectFilePlacement({ config: config.checks.filePlacement,
    changes: [...good, ...bad].map((file) => ({ path: file, status: 'A', oldPath: null })) });
  assert.equal(result.violations.length, bad.length);
  for (const [file, expected] of [['src/order.vue', 700], ['src/composables/use-order.ts', 400], ['src/utils/order.ts', 400],
    ['src/api/order.ts', 500], ['src/stores/order.ts', 500], ['src/main.ts', 1000], ['styles/main.scss', 500], ['src/main.css', 500]]) {
    assert.equal(matchMaxFileLineRule(file, config.checks.maxFileLines).maxLines, expected, file);
  }
  assert.equal(matchMaxFileLineRule('scripts/main.ts', config.checks.maxFileLines), null);
});

test('函数文档缺失在暂存入口阻断并恢复自动同步前的源码', async (t) => {
  const root = fixture(t); assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  const file = write(root, 'src/api/order.ts', 'export function order(id) { return id; }');
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
  const isolated = structuredClone(config);
  for (const check of Object.values(isolated.checks)) check.enabled = false;
  isolated.checks.functionDocs = docs;
  const before = readFileSync(file, 'utf8');
  const result = await runQualityExecution({ root, files: [file], config: isolated });
  assert.equal(result.exitCode, 2);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('函数文档仅同步公开函数，并检查真实说明且保持幂等', () => {
  const undocumented = 'function internal(x) { return x; }\nexport function order(id) { return id; }';
  const result = synchronizeFunctionDocumentationContent(undocumented, 'src/api/order.ts', docs);
  assert.ok(result.content.startsWith('function internal'));
  assert.equal(result.warnings.filter((item) => item.blocking).length, 1);
  const documented = '/**\n * 查询订单。\n * @param id 订单标识\n * @returns 订单数据\n * @remarks 无副作用\n */\nexport function order(id) { return id; }';
  const valid = synchronizeFunctionDocumentationContent(documented, 'src/api/order.ts', docs);
  assert.equal(valid.warnings.filter((item) => item.blocking).length, 0);
  assert.equal(synchronizeFunctionDocumentationContent(valid.content, 'src/api/order.ts', docs).content, valid.content);
  for (const source of ['const order = (id) => id; export { order };', 'export default function(id) { return id; }', 'export function order({ id }) { return id; }', 'export class Order { save(id) { return id; } }']) {
    assert.ok(synchronizeFunctionDocumentationContent(source, 'src/api/order.ts', docs).warnings.some((item) => item.blocking), source);
  }
});

test('函数文档只读门禁使用违规退出码，不将空标签作为完成证据', async (t) => {
  const root = fixture(t); const file = write(root, 'src/api/order.ts', 'export function order(id) { return id; }');
  const context = { root, config, files: [file], environment: 'ci-policy' };
  const before = readFileSync(file, 'utf8');
  const result = await functionDocumentationGate.run({ ...context, plan: await functionDocumentationGate.plan(context) });
  assert.equal(result.status, 'violation'); assert.equal(gateResultToExitCode(result), 2);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('真实架构工具验证全部预设并阻断跨业务内部引用与反向分层', async (t) => {
  const root = fixture(t);
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  write(root, 'package.json', JSON.stringify({ name: 'maintenance-fixture', version: '1.0.0', type: 'module' }));
  write(root, 'src/features/orders/internal.js', 'export const order = 1;');
  write(root, 'src/features/orders/index.js', "export { order } from './internal.js';");
  write(root, 'src/features/users/index.js', "import '../orders/internal.js';");
  write(root, 'src/utils/helper.js', "import '../features/orders/index.js';");
  const result = await runArchitectureGate({ root, config: config.checks.architecture });
  assert.equal(result.status, 'violation', JSON.stringify(result));
  assert.ok(JSON.stringify(result).includes('no-feature-internals'));
  assert.ok(JSON.stringify(result).includes('no-utils-to-business'));
  write(root, 'src/features/users/index.js', "import '../orders/index.js';");
  write(root, 'src/utils/helper.js', 'export const value = 1;');
  assert.equal((await runArchitectureGate({ root, config: config.checks.architecture })).status, 'passed');
});

test('依赖公开的 src 子路径不会被目录名称限制误报', async (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'node_modules'));
  symlinkSync(path.join(process.cwd(), 'node_modules/dependency-cruiser'), path.join(root, 'node_modules/dependency-cruiser'), process.platform === 'win32' ? 'junction' : 'dir');
  write(root, 'package.json', JSON.stringify({ name: 'public-import-fixture', version: '1.0.0', type: 'module', dependencies: { 'public-sdk': '1.0.0' } }));
  write(root, 'node_modules/public-sdk/package.json', JSON.stringify({ name: 'public-sdk', version: '1.0.0', type: 'module', exports: { './src/helper.js': './src/helper.js' } }));
  write(root, 'node_modules/public-sdk/src/helper.js', 'export const helper = 1;');
  write(root, 'src/main.js', "import { helper } from 'public-sdk/src/helper.js'; export { helper };");
  const result = await runArchitectureGate({ root, config: config.checks.architecture });
  assert.equal(result.status, 'passed', JSON.stringify(result));
});


test('前端全部主开关按预设校验，TS 写入类型工具选项，缺 Token 清单明确失败', (t) => {
  const expected = ['sourceSecurity', 'eslint', 'prettier', 'stylelint', 'maxFileLines', 'filePlacement', 'fileHeader', 'functionDocs', 'asyncResourceCleanup', 'pathNaming', 'deadCode', 'imageAssets', 'unusedImageAssets', 'architecture', 'build', 'lighthouse', 'unitTest', 'coverage', 'mutationTest'];
  for (const preset of ['vue-typescript', 'vue-javascript']) {
    const document = createProjectDocument({ ...project, preset });
    for (const name of expected) assert.equal(document.checks[name].enabled, true, name);
    assert.equal(document.checks.typeCheck.enabled, preset === 'vue-typescript');
    if (preset === 'vue-typescript') {
      assert.equal(document.checks.typeCheck.options.tool, 'vue-tsc');
      assert.equal(document.checks.typeCheck.options.compilerOptions.strict, true);
    }
    assert.equal(document.checks.stylelint.uiTokens.enabled, true);
    assert.equal(document.repository.dependencyPolicy.enabled, true);
    assert.equal(document.repository.codePlacement.enabled, false);
  }
  const old = normalizeProjectDocument({ version: 2, project, checks: { typeCheck: { enabled: false }, stylelint: { enabled: true, uiTokens: { enabled: false } } } });
  assert.equal(old.checks.typeCheck.enabled, false);
  assert.equal(old.checks.stylelint.uiTokens.enabled, false);
  const backend = createProjectDocument({ id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' });
  assert.equal(backend.checks.typeCheck.enabled, true);
  assert.equal(backend.checks.typeCheck.options, undefined);
  assert.equal(backend.checks.pathNaming.convention, 'camelCase');
  assert.equal(backend.checks.stylelint.uiTokens.enabled, false);
  assert.throws(() => loadUiTokenManifest(fixture(t), config.checks.stylelint.uiTokens), { code: 'ui-token/file-missing' });
});
