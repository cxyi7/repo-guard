import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { createProjectDocument, normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { JAVA_PROJECT_CHECKS } from '../../src/config/project-feature-paths.js';
import { JAVA_DEFAULT_ENABLED_CHECKS } from '../../src/profiles/java-check-presets.js';

const project = { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' };
const schema = JSON.parse(readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);

test('Java 新建模板开关完整，接入缺项不伪造且严格 Schema 拒绝', () => {
  assert.deepEqual(JAVA_DEFAULT_ENABLED_CHECKS, JAVA_PROJECT_CHECKS);
  const document = createProjectDocument(project);
  for (const feature of JAVA_PROJECT_CHECKS) assert.equal(document.checks[feature].enabled, true);
  assert.equal(document.checks.javaFormat.command, null);
  assert.deepEqual(document.checks.javaBuild.modules, []);
  assert.equal(document.checks.javaSpotbugs.pluginVersion, '');
  assert.equal(document.checks.javaMutationTest.pluginVersion, '');
  assert.equal(validate(document), false);
  assert.throws(() => normalizeProjectDocument(document), /必须显式指定已准备的工具/);
});

test('Java 模板补齐全部配置后通过 Schema 和运行配置校验，阈值不降低', () => {
  const document = createProjectDocument(project);
  for (const check of Object.values(document.checks)) {
    if (check.enabled && Object.hasOwn(check, 'command')) {
      check.command = 'java';
      check.args = ['-jar', 'tools/test-tool.jar'];
    }
  }
  // 本用例仅验证配置结构，不将这些测试夹具路径作为真实工具执行证据。
  const reports = ['target/surefire-reports/TEST-example.AppTest.xml'];
  const module = (fields) => [{ name: 'app', directory: '.', ...fields }];
  document.checks.javaArchitecture.modules = module({ reports, requiredTestClasses: ['example.ArchitectureTest'] });
  document.checks.javaDependencies.modules = module({ effectivePom: 'target/effective-pom.xml', dependencyTree: 'target/dependencies.json' });
  document.checks.javaDependencies.enforcerExecution = 'dependency-check';
  document.checks.javaCompile.modules = module({ outputs: ['target/classes/example/App.class'] });
  document.checks.javaBuild.modules = module({ outputs: ['target/app.jar'] });
  document.checks.javaTest.modules = module({ reports });
  document.checks.javaCoverage.modules = module({ reports, coverageReport: 'target/site/jacoco/jacoco.xml' });
  document.checks.javaSpotbugs.modules = module({ reports: ['target/spotbugsXml.xml'] });
  document.checks.javaSpotbugs.pluginVersion = '4.10.3.0';
  document.checks.javaMutationTest.modules = module({ reports, mutationReport: 'target/pit-reports/mutations.xml', targetClasses: ['example.App'], targetTests: ['example.AppTest'] });
  document.checks.javaMutationTest.pluginVersion = '1.17.3';
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  const normalized = normalizeProjectDocument(document);
  for (const feature of JAVA_PROJECT_CHECKS) assert.equal(normalized.checks[feature].enabled, true);
  assert.equal(normalized.checks.javaCoverage.thresholds.line, 80);
  assert.equal(normalized.checks.javaMutationTest.threshold, 80);
  assert.equal(normalized.checks.javaSize.maxMethodLines, 100);
});

test('Java 已有关闭值及省略值不被新建模板覆盖，模板间不共享数组', () => {
  const config = normalizeProjectDocument({ version: 2, project, checks: { javaSize: { enabled: false, maxFileLines: 777 } } });
  for (const feature of JAVA_PROJECT_CHECKS) assert.equal(config.checks[feature].enabled, false);
  assert.equal(config.checks.javaSize.maxFileLines, 777);
  const first = createProjectDocument(project);
  first.checks.javaBuild.modules.push({ name: 'changed' });
  assert.deepEqual(createProjectDocument(project).checks.javaBuild.modules, []);
});
