import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizeProjectDocument, createProjectDocument } from '../../src/config/project-configuration.js';
import { PROJECT_CHECK_PATHS } from '../../src/config/project-feature-paths.js';
import { JAVA_SOURCE_SCHEMA_PROPERTIES } from '../../src/config/java-source-schema.js';
import { JAVA_ENGINEERING_SCHEMA_PROPERTIES } from '../../src/config/java-engineering-schema.js';
import { JAVA_PATH_NAMING_SCHEMA_PROPERTIES } from '../../src/config/java-path-naming.js';
import { JAVA_SPOTBUGS_SCHEMA_PROPERTIES } from '../../src/config/java-spotbugs.js';
import { JAVA_MUTATION_SCHEMA_PROPERTIES } from '../../src/config/java-mutation.js';
import { gateRegistry } from '../../src/gates/registry.js';
import {
  CONFIGURABLE_FEATURES,
} from '../../src/orchestration/setup/config-management.js';

const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));
const singleSchema = schema.$defs.singleProjectDocument;
const frontend = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const validateSchema = ajv.compile(schema);

function featurePath(feature) {
  if (PROJECT_CHECK_PATHS[feature]) return `checks.${feature}`;
  if (feature === 'dependencies') return 'repository.dependencyPolicy';
  if (feature === 'repositoryFilePlacement') return 'repository.filePlacement';
  if (['commitMessage', 'codePlacement', 'deliveryContract'].includes(feature)) return `repository.${feature}`;
  if (feature === 'ci') return 'ci';
  return `reporting.${feature}`;
}

function valueAtPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, segment) => current?.[segment], value);
}

function schemaAtPath(value, dottedPath) {
  return dottedPath.split('.').reduce(
    (current, segment) => current?.properties?.[segment],
    value,
  );
}

function collectSchemaDefaultDifferences(schemaNode, runtimeValue, path = '') {
  const differences = [];
  if (
    Object.hasOwn(schemaNode, 'default')
    && !Object.is(runtimeValue, undefined)
    && JSON.stringify(schemaNode.default) !== JSON.stringify(runtimeValue)
  ) {
    differences.push({
      path,
      runtimeValue,
      schemaDefault: schemaNode.default,
    });
  }
  for (const [property, childSchema] of Object.entries(schemaNode.properties ?? {})) {
    if (runtimeValue?.[property] === undefined) continue;
    const childPath = path ? `${path}.${property}` : property;
    differences.push(...collectSchemaDefaultDifferences(
      childSchema,
      runtimeValue[property],
      childPath,
    ));
  }
  return differences;
}

test('keeps starter top-level configuration synchronized with the public schema', () => {
  const starter = createProjectDocument(frontend);

  assert.deepEqual(
    Object.keys(starter).sort(),
    Object.keys(singleSchema.properties).sort(),
  );
  assert.doesNotThrow(() => normalizeProjectDocument(starter));
  assert.equal(validateSchema(starter), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(collectSchemaDefaultDifferences(singleSchema, starter), []);
});

test('keeps every configurable Gate connected to starter config and schema paths', () => {
  const starter = createProjectDocument(frontend);
  const normalized = normalizeProjectDocument(starter);

  for (const gate of gateRegistry.configurable) {
    assert.notEqual(
      valueAtPath(normalized, gate.configKey),
      undefined,
      `${gate.id} 的 starter 配置缺少 ${gate.configKey}`,
    );
    assert.notEqual(
      schemaAtPath(singleSchema, featurePath(gate.featureName)),
      undefined,
      `${gate.id} 的 Schema 缺少 ${gate.configKey}`,
    );
  }
});

test('50 个开关在新文档、真实 Schema 和运行时保持一致', () => {
  const externalFeatures = [
    ...Object.keys(singleSchema.properties.checks.properties),
    'codePlacement', 'commitMessage', 'dependencies', 'deliveryContract', 'repositoryFilePlacement',
    'notification', 'commitAnimation', 'ci',
  ];
  assert.equal(externalFeatures.length, 50);
  assert.deepEqual([...externalFeatures].sort(), [...CONFIGURABLE_FEATURES].sort());
  for (const preset of ['vue-typescript', 'vue-javascript', 'node-typescript', 'node-javascript']) {
    const descriptor = { id: 'app', role: preset.startsWith('node') ? 'backend' : 'frontend', stack: 'node', preset };
    const document = createProjectDocument(descriptor);
    assert.equal(validateSchema(document), true, JSON.stringify(validateSchema.errors));
    assert.doesNotThrow(() => normalizeProjectDocument(document));
    for (const feature of externalFeatures) {
      const field = valueAtPath(document, featurePath(feature));
      assert.equal(typeof field.enabled, 'boolean', `${preset} 中 ${feature} 的开关必须明确`);
    }
  }
  const invalid = createProjectDocument(frontend);
  invalid.checks.unknownEngineeringCheck = { enabled: true };
  assert.equal(validateSchema(invalid), false);
  assert.throws(() => normalizeProjectDocument(invalid));
});

test('derives configurable Gate feature names from the Registry without omissions', () => {
  const registryFeatures = gateRegistry.configurable.map(({ featureName }) => featureName);
  const nonGateFeatures = [
    'componentInteraction',
    'coverage',
    'fileHeader',
    'functionDocs',
    'notification',
    'commitAnimation',
    'ci',
  ];

  assert.deepEqual(CONFIGURABLE_FEATURES, [...registryFeatures, ...nonGateFeatures]);
  assert.equal(new Set(CONFIGURABLE_FEATURES).size, CONFIGURABLE_FEATURES.length);
});

test('Java 与 Node 检查的技术栈隔离同时受公开 Schema 和运行时约束', () => {
  const java = createProjectDocument({ id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' });
  assert.equal(validateSchema(java), true, JSON.stringify(validateSchema.errors));
  const badJava = structuredClone(java);
  badJava.checks.eslint.enabled = true;
  assert.equal(validateSchema(badJava), false);
  assert.throws(() => normalizeProjectDocument(badJava), /不适用于当前项目技术栈/);
  const badNode = createProjectDocument(frontend);
  badNode.checks.javaFiles.enabled = true;
  assert.equal(validateSchema(badNode), false);
  assert.throws(() => normalizeProjectDocument(badNode), /不适用于当前项目技术栈/);
  const gradle = { ...java, project: { ...java.project, preset: 'java-gradle' } };
  assert.equal(validateSchema(gradle), false);
  assert.throws(() => normalizeProjectDocument(gradle), /尚未支持/);
});

test('公开 Java Schema 与功能模块维护的约束同步，并拒绝开启缺少证据配置的检查', () => {
  for (const [feature, fragment] of Object.entries({
    ...JAVA_SOURCE_SCHEMA_PROPERTIES, ...JAVA_ENGINEERING_SCHEMA_PROPERTIES,
    ...JAVA_PATH_NAMING_SCHEMA_PROPERTIES, ...JAVA_SPOTBUGS_SCHEMA_PROPERTIES, ...JAVA_MUTATION_SCHEMA_PROPERTIES,
  })) {
    assert.deepEqual(singleSchema.properties.checks.properties[feature], fragment, feature);
  }
  const java = createProjectDocument({ id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' });
  for (const feature of ['javaFormat', 'javaArchitecture', 'javaDependencies', 'javaCompile', 'javaBuild', 'javaTest', 'javaCoverage', 'javaSpotbugs', 'javaMutationTest']) {
    const enabled = structuredClone(java);
    enabled.checks[feature].enabled = true;
    assert.equal(validateSchema(enabled), false, feature);
    assert.throws(() => normalizeProjectDocument(enabled), undefined, feature);
  }
});
