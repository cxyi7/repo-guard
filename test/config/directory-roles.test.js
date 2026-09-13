import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import micromatch from 'micromatch';
import { createProjectDocument, normalizeProjectDocument, serializeProjectConfig } from '../../src/config/project-configuration.js';
import { validateDirectoryRoles, resolveDirectoryPaths } from '../../src/config/directory-roles.js';
import { DIRECTORY_ROLES_SCHEMA } from '../../src/config/directory-roles-schema.js';
import { renderAgentPolicyDocument } from '../../src/policies/agent-policies.js';
import { inspectFilePlacement } from '../../src/policies/file-placement.js';
import { matchMaxFileLineRule } from '../../src/policies/max-file-lines.js';

const front = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };
const node = { id: 'api', role: 'backend', stack: 'node', preset: 'node-typescript' };
const java = { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' };
const document = (project = front) => serializeProjectConfig(createProjectDocument(project));

test('目录 Schema 与运行模块一致，新建绑定保存后不保留派生路径，重复读写稳定', () => {
  const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));
  assert.deepEqual(schema.$defs.singleProjectDocument.properties.directories, DIRECTORY_ROLES_SCHEMA);
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const raw = document();
  assert.equal(raw.checks.unitTest.sourcePatterns, undefined);
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  const config = normalizeProjectDocument(raw);
  assert.deepEqual(serializeProjectConfig(config), raw);
  assert.deepEqual(normalizeProjectDocument(serializeProjectConfig(config)), config);
});

test('前端公共方法、测试目录改名联动归位、规模、测试映射、变异及 AI 规范', () => {
  const raw = document();
  raw.directories.entries.utils.path = 'shared/helpers';
  raw.directories.entries.tests.path = 'quality/specs';
  const config = normalizeProjectDocument(raw);
  assert.deepEqual(config.checks.unitTest.sourcePatterns, ['shared/helpers/**/*.{js,ts}']);
  assert.equal(config.checks.unitTest.mappings[0].sourceRoot, 'shared/helpers');
  assert.equal(config.checks.unitTest.mappings[0].testTemplates[0], 'quality/specs/utils/{relativePath}.test.{ext}');
  assert.ok(config.checks.mutationTest.options.mutate.includes('shared/helpers/**/*.{js,ts}'));
  assert.equal(matchMaxFileLineRule('shared/helpers/math.ts', config.checks.maxFileLines).maxLines, 400);
  const result = inspectFilePlacement({ config: config.checks.filePlacement, changes: [
    { path: 'quality/specs/math.test.ts', status: 'A' }, { path: 'src/tests/math.test.ts', status: 'A' },
  ] });
  assert.equal(result.violations.length, 1);
  const text = renderAgentPolicyDocument('', config);
  assert.match(text, /shared\/helpers/);
  assert.match(text, /公共方法/);
  assert.match(text, /不代表程序已确认代码业务语义/);
});

test('目录点号作为正则字面量，业务分层多选路径同样跟随改名', () => {
  const raw = document();
  raw.directories.entries.source.path = 'app.v2';
  raw.directories.entries.pages.path = 'screens';
  const config = normalizeProjectDocument(raw);
  const rule = config.checks.architecture.rules.find((item) => item.name === 'no-components-to-pages');
  assert.ok(new RegExp(rule.from.path).test('app.v2/components/button.ts'));
  assert.ok(!new RegExp(rule.from.path).test('appXv2/components/button.ts'));
  assert.ok(new RegExp(rule.to.path).test('screens/order.ts'));
  assert.ok(!new RegExp(rule.to.path).test('app.v2/pages/order.ts'));
});

test('样式、资源、构建目录联动实际 glob 和 Token 范围，不开启后端样式', () => {
  const raw = document();
  raw.directories.entries.styles.path = 'theme';
  raw.directories.entries.assets.path = 'media';
  raw.directories.entries.output.path = 'release';
  const config = normalizeProjectDocument(raw);
  assert.deepEqual(config.checks.stylelint.governance.allowedGlobalStylePatterns, ['theme/**']);
  assert.ok(micromatch.isMatch('theme/main.scss', config.checks.stylelint.uiTokens.include));
  assert.equal(config.checks.build.artifactBudget.outputDirectory, 'release');
  assert.ok(config.checks.imageAssets.duplicates.canonicalRoots.includes('media'));
  assert.equal(normalizeProjectDocument(document(node)).checks.stylelint.enabled, false);
});

test('Node 自定义源码与测试根映射一致，Java 源码根与文件规范一起变化', () => {
  const raw = document(node);
  raw.directories.entries.source.path = 'server'; raw.directories.entries.tests.path = 'spec';
  const config = normalizeProjectDocument(raw);
  assert.equal(config.checks.unitTest.mappings[0].sourceRoot, 'server');
  assert.ok(config.checks.unitTest.mappings[0].testTemplates[0].startsWith('spec/'));
  assert.deepEqual(config.checks.architecture.sourcePaths, ['server']);
  const javaRaw = document(java);
  for (const check of Object.values(javaRaw.checks)) check.enabled = false;
  javaRaw.directories.entries.source.path = 'code/main';
  const javaConfig = normalizeProjectDocument(javaRaw);
  assert.ok(micromatch.isMatch('code/main/app/Order.java', javaConfig.checks.javaFormat.include));
  assert.ok(!micromatch.isMatch('src/main/java/app/Order.java', javaConfig.checks.javaFormat.include));
  assert.ok(micromatch.isMatch('code/main/app/Order.java', javaConfig.checks.javaFiles.allowedJavaRoots));
  assert.ok(micromatch.isMatch('code/main/app/Order.java', javaConfig.checks.javaPathNaming.include));
});

test('未知职责、循环、越界、危险键和非路径字段绑定明确拒绝', () => {
  for (const path of ['/outside', '../outside', 'src/../outside', 'C:/outside', 'src/**', 'src\\utils']) {
    assert.throws(() => validateDirectoryRoles({ entries: { source: { path, purpose: '源码' } } }), /相对目录/);
  }
  assert.throws(() => validateDirectoryRoles({ entries: { source: { path: '${missing}', purpose: '源码' } } }), /未登记/);
  assert.throws(() => validateDirectoryRoles({ entries: { source: { path: '${tests}', purpose: '源码' }, tests: { path: '${source}', purpose: '测试' } } }), /循环/);
  const raw = document(); raw.directories.bindings['checks.coverage.enabled'] = { format: 'path', value: false };
  assert.throws(() => normalizeProjectDocument(raw), /不允许绑定/);
  assert.throws(() => validateDirectoryRoles(JSON.parse('{"entries":{"__proto__":{"path":"src","purpose":"源码"}}}')), /职责标识/);
});

test('绑定不能绕过原字段校验，移除绑定后尊重用户独立路径，旧配置不猜测目录', () => {
  const raw = document();
  raw.directories.bindings['checks.unitTest.sourcePatterns'].value = [7];
  assert.throws(() => normalizeProjectDocument(raw));
  delete raw.directories.bindings['checks.unitTest.sourcePatterns'];
  raw.checks.unitTest.sourcePatterns = ['custom/**/*.ts'];
  assert.deepEqual(normalizeProjectDocument(raw).checks.unitTest.sourcePatterns, ['custom/**/*.ts']);
  assert.equal(normalizeProjectDocument({ version: 2, project: front }).directories, undefined);
  const a = validateDirectoryRoles({ entries: { source: { path: 'a', purpose: '源码' } } });
  const b = validateDirectoryRoles({ entries: { source: { path: 'b', purpose: '源码' } } });
  assert.equal(resolveDirectoryPaths(a).source, 'a'); assert.equal(resolveDirectoryPaths(b).source, 'b');
});

test('与当前绑定结果相同的显式用户路径写回后仍独立，不随之后的目录改名变化', () => {
  const raw = document();
  raw.checks.unitTest.sourcePatterns = ['src/utils/**/*.{js,ts}'];
  const saved = serializeProjectConfig(normalizeProjectDocument(raw));
  assert.deepEqual(saved.checks.unitTest.sourcePatterns, raw.checks.unitTest.sourcePatterns);
  saved.directories.entries.utils.path = 'shared/helpers';
  assert.deepEqual(normalizeProjectDocument(saved).checks.unitTest.sourcePatterns, raw.checks.unitTest.sourcePatterns);
});

test('用户自定义引用模板写回后保留引用，后续目录改名仍联动', () => {
  const raw = document();
  raw.checks.unitTest.sourcePatterns = ['${utils}/math/**/*.ts'];
  const saved = serializeProjectConfig(normalizeProjectDocument(raw));
  assert.deepEqual(saved.checks.unitTest.sourcePatterns, raw.checks.unitTest.sourcePatterns);
  saved.directories.entries.utils.path = 'shared/helpers';
  assert.deepEqual(normalizeProjectDocument(saved).checks.unitTest.sourcePatterns, ['shared/helpers/math/**/*.ts']);
});

test('目录绑定显式 null 与 Schema 一致地拒绝，不能被当成未配置', () => {
  const raw = { version: 2, project: front, directories: {
    entries: { source: { path: 'src', purpose: '源码。' } }, bindings: null,
  } };
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync('config.schema.json', 'utf8')));
  assert.equal(validate(raw), false);
  assert.throws(() => validateDirectoryRoles(raw.directories), /必须是对象/);
  assert.throws(() => normalizeProjectDocument(raw), /必须是对象/);
});

for (const preset of ['vue-javascript', 'vue-typescript', 'node-javascript', 'node-typescript']) {
  test(`${preset} 提供独立的通用目录职责，源码及测试改名后查找范围联动`, () => {
    const frontend = preset.startsWith('vue-');
    const project = { id: 'app', role: frontend ? 'frontend' : 'backend', stack: 'node', preset };
    const raw = document(project);
    const roles = ['source', 'tests', 'utils', 'types', 'config', 'output', 'coverage', 'reports', 'docs'];
    const specific = frontend
      ? ['utilityTests', 'styles', 'assets', 'public', 'components', 'pages', 'views', 'composables', 'api', 'stores', 'store', 'features', 'shared', 'constants']
      : ['controller', 'service', 'repository', 'middleware'];
    assert.deepEqual(Object.keys(raw.directories.entries).sort(), [...roles, ...specific].sort());
    for (const item of Object.values(raw.directories.entries)) assert.ok(item.purpose.trim());
    const defaults = resolveDirectoryPaths(raw.directories);
    assert.equal(defaults.tests, frontend ? 'src/tests' : 'test');
    assert.equal(defaults.utils, 'src/utils');
    raw.directories.entries.source.path = 'application';
    raw.directories.entries.tests.path = 'specs';
    const config = normalizeProjectDocument(raw);
    const source = frontend ? 'application/utils/math.ts' : 'application/services/order.ts';
    assert.ok(micromatch.isMatch(source, config.checks.unitTest.sourcePatterns));
    assert.ok(!micromatch.isMatch(source.replace('application/', 'src/'), config.checks.unitTest.sourcePatterns));
    assert.ok(config.checks.unitTest.mappings[0].testTemplates.every((value) => value.startsWith('specs/')));
    assert.deepEqual(config.checks.architecture.sourcePaths, ['application']);
    assert.equal(resolveDirectoryPaths(document(project).directories).source, 'src');
    if (!frontend) assert.equal(config.checks.stylelint.enabled, false);
    assert.deepEqual(serializeProjectConfig(normalizeProjectDocument(serializeProjectConfig(config))), serializeProjectConfig(config));
  });
}
