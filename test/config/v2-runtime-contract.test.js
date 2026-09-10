import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateConfig } from '../../src/config/configuration-validation.js';
import {
  createProjectDocument,
  normalizeProjectDocument,
  normalizeRepositoryDocument,
  serializeProjectConfig,
} from '../../src/config/project-configuration.js';

const project = {
  id: 'app',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-typescript',
};
const legacy = {
  version: 1,
  rules: [{ pattern: 'config/**', category: '项目配置', level: 'notify' }],
};

test('子应用 Schema 与工作区归属规则一致且复用主配置字段定义', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8'),
  );
  const projectSchema = JSON.parse(
    readFileSync(new URL('../../project.schema.json', import.meta.url), 'utf8'),
  );
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  ajv.addSchema(schema, 'config.schema.json');
  const validate = ajv.compile(projectSchema);
  assert.equal(
    validate({ version: 2, project, checks: { unitTest: { enabled: true } } }),
    true,
  );
  for (const field of ['repository', 'ci']) assert.equal(validate({ version: 2, project, [field]: {} }), true, field);
  assert.equal(validate({ version: 2, project, reporting: {} }), false);
  assert.equal(validate({ version: 2, project, repository: { commitMessage: { enabled: true } } }), false);
  assert.equal(validate({ version: 2, project, ci: { profile: 'full' } }), false);
  assert.equal(
    validate({ version: 2, project, checks: { unitTest: { coverage: {} } } }),
    false,
  );
});

test('所有配置入口共享原生 v2 模型且不泄露旧字段', () => {
  const document = createProjectDocument(project);
  const normalized = normalizeProjectDocument(document);
  assert.deepEqual(validateConfig(document), normalized);
  assert.deepEqual(serializeProjectConfig(normalized), document);
  for (const config of [normalized, normalizeRepositoryDocument(document)]) {
    assert.equal(config.version, 2);
    for (const field of [
      'configVersion',
      'preCommit',
      'unitTest',
      'rules',
      'externalGates',
    ]) {
      assert.equal(Object.hasOwn(config, field), false);
    }
    assert.equal(Object.hasOwn(config.ci, 'pipeline'), false);
    assert.equal(Object.hasOwn(config.checks.unitTest, 'coverage'), false);
    assert.equal(Object.hasOwn(config.checks.stylelint, 'complexity'), false);
    assert.equal(Object.hasOwn(config.checks.imageAssets, 'unused'), false);
  }
});

test('正常执行拒绝旧版本和新配置中的旧流水线属性', () => {
  assert.throws(() => validateConfig(legacy), {
    code: 'config/unsupported-version',
  });
  assert.throws(
    () =>
      normalizeProjectDocument({
        version: 2,
        project,
        ci: { pipeline: { enabled: false } },
      }),
    /ci.*pipeline/,
  );
  assert.throws(
    () =>
      normalizeProjectDocument({
        version: 2,
        project,
        checks: { unitTest: { coverage: {} } },
      }),
    /checks\.coverage/,
  );
});

test('v2 显式空值不能静默替代默认对象、数组或阈值', () => {
  for (const fields of [
    { checks: null },
    { repository: null },
    { reporting: null },
    { ci: null },
    { ci: { externalGates: null } },
    { ci: { protectedFiles: null } },
    { ci: { gatePolicy: { gates: null } } },
    { repository: { rules: null } },
    { repository: { exclusions: null } },
    { repository: { dependencyPolicy: null } },
    { repository: { exceptions: null } },
    { reporting: { notification: null } },
    { checks: { coverage: { thresholds: null } } },
    { checks: { unitTest: { enabled: null } } },
    { checks: { maxFileLines: { exclusions: null } } },
  ]) {
    assert.throws(
      () => normalizeProjectDocument({ version: 2, project, ...fields }),
      /必须是对象|必须是数组|不允许为空值/,
    );
  }
  const normalized = normalizeProjectDocument({
    version: 2,
    project,
    checks: {
      lighthouse: { configFile: null },
      deadCode: { configFile: null },
      build: { artifactBudget: { platform: null } },
    },
  });
  assert.equal(normalized.checks.lighthouse.configFile, null);
  assert.equal(normalized.checks.deadCode.configFile, null);
  assert.equal(normalized.checks.build.artifactBudget.platform, null);
});

test('v2 覆盖率必须使用独立对象，不能接受旧布尔开关', () => {
  for (const coverage of [true, false]) {
    assert.throws(
      () => normalizeProjectDocument({ version: 2, project, checks: { coverage } }),
      /checks\.coverage.*对象/,
    );
  }
});

test('公开 API 与配置命令不再暴露 v1 转换入口', async () => {
  const [api, setup, configuration, command] = await Promise.all([
    import('../../src/index.js'),
    import('../../src/orchestration/setup/config-management.js'),
    import('../../src/config/project-configuration.js'),
    import('../../src/orchestration/cli/configuration.js'),
  ]);
  for (const exports of [api, setup, configuration, command]) {
    for (const name of ['migrateLegacyConfig', 'migrateProjectConfig', 'runMigrate']) {
      assert.equal(Object.hasOwn(exports, name), false, name);
    }
  }
});
