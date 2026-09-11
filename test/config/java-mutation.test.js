import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { JAVA_MUTATION_SCHEMA_PROPERTIES, validateJavaMutationChecks } from '../../src/config/java-mutation.js';
import { mutationConfig } from '../integrations/java/mutation/fixture.js';

test('PIT 共用 Maven 字段错误保留实际配置文件和功能路径', () => {
  for (const [field, value] of [['timeoutMs', 0], ['offline', 'yes'], ['executable', ''], ['pom', '../pom.xml'], ['arguments', ['--skip']], ['modules', []]]) {
    assert.throws(() => validateJavaMutationChecks({ javaMutationTest: { ...mutationConfig(), [field]: value } }, {
      configPath: 'apps/api/guard.project.json',
    }), (error) => {
      assert.match(error.message, /apps\/api\/guard.project.json checks\.javaMutationTest/);
      assert.ok(error.message.includes(field));
      assert.doesNotMatch(error.message, /checks\.javaTest/);
      return true;
    });
  }
});

test('Java 变异测试默认关闭且启用必须声明固定工具和模块证据', () => {
  const defaults = validateJavaMutationChecks({}).javaMutationTest;
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.timeoutMs, 600000);
  assert.equal(defaults.offline, true);
  assert.throws(() => validateJavaMutationChecks({ javaMutationTest: { enabled: true } }), /模块/);
  assert.throws(() => validateJavaMutationChecks({ javaMutationTest: null }), /必须是对象/);
  assert.throws(() => mutationConfig({ pluginVersion: 'LATEST' }), /固定正式版本/);
  assert.throws(() => mutationConfig({ pluginVersion: '1.17.3-SNAPSHOT' }), /固定正式版本/);
  assert.throws(() => mutationConfig({ threshold: 101 }), /threshold/);
  assert.throws(() => mutationConfig({ executable: 'mvnw.cmd' }), /Wrapper/);
  assert.throws(() => mutationConfig({ skip: true }), /skip/);
  const validate = new Ajv({ strict: false }).compile(JAVA_MUTATION_SCHEMA_PROPERTIES.javaMutationTest);
  assert.ok(validate(mutationConfig()), JSON.stringify(validate.errors));
  assert.equal(validate({ enabled: true, modules: [] }), false);
});
test('PIT 拒绝越界、复用报告和可绕过变异执行的参数', () => {
  const config = mutationConfig();
  for (const mutationReport of ['../mutations.xml', 'src/mutations.xml', 'target/*.xml', 'target/another.xml']) {
    assert.throws(() => mutationConfig({ modules: [{ ...config.modules[0], mutationReport }] }));
  }
  assert.throws(() => mutationConfig({ modules: [{ ...config.modules[0], reports: ['target/pit-reports/mutations.xml'] }] }), /不得重复/);
  for (const argument of ['-DskipPitest=true', '-Dpit.dryRun=true', '-DwithHistory=true', '-DtargetClasses=other.*', '-Dfeatures=FILTER', '-DoutputFormats=HTML', '-DavoidCallsTo=example.App', '-Dmutators=VOID_METHOD_CALLS', '-Dmode=production', '-DfutureFilter=example.App']) {
    assert.throws(() => mutationConfig({ arguments: [argument] }));
  }
  for (const targetClasses of [[], ['example.*', 'example.*'], ['example.[A-Z]'], ['a,b'], ['../example']]) {
    assert.throws(() => mutationConfig({ modules: [{ ...config.modules[0], targetClasses }] }), /模式数组/);
  }
  assert.doesNotThrow(() => mutationConfig({ arguments: ['-Pquality', '-DrepoGuard.mode=production', '-Dmaven.repo.local=cache'] }));
  const validate = new Ajv({ strict: false }).compile(JAVA_MUTATION_SCHEMA_PROPERTIES.javaMutationTest);
  assert.equal(validate({ arguments: ['-DavoidCallsTo=example.App'] }), false);
  for (const targetClasses of [Array.from({ length: 33 }, (_, index) => `example.Class${index}`), ['a'.repeat(257)], Array.from({ length: 32 }, (_, index) => `example.Class${index}${'a'.repeat(70)}`)]) assert.throws(() => mutationConfig({ modules: [{ ...config.modules[0], targetClasses }] }), /最多 32 个模式/);
});
