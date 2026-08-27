import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateConfig } from '../src/config/configuration-validation.js';
import { gateRegistry } from '../src/gates/registry.js';
import {
  CONFIGURABLE_FEATURES,
  createStarterConfig,
} from '../src/orchestration/setup/config-management.js';

const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));

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
  const starter = createStarterConfig();

  assert.deepEqual(
    Object.keys(starter).sort(),
    Object.keys(schema.properties).sort(),
  );
  assert.doesNotThrow(() => validateConfig(starter));
  assert.deepEqual(collectSchemaDefaultDifferences(schema, starter), []);
});

test('keeps every configurable Gate connected to starter config and schema paths', () => {
  const starter = createStarterConfig();

  for (const gate of gateRegistry.configurable) {
    assert.notEqual(
      valueAtPath(starter, gate.configKey),
      undefined,
      `${gate.id} 的 starter 配置缺少 ${gate.configKey}`,
    );
    assert.notEqual(
      schemaAtPath(schema, gate.configKey),
      undefined,
      `${gate.id} 的 Schema 缺少 ${gate.configKey}`,
    );
  }
});

test('derives configurable Gate feature names from the Registry without omissions', () => {
  const registryFeatures = gateRegistry.configurable.map(({ featureName }) => featureName);
  const nonGateFeatures = [
    'componentInteraction',
    'coverage',
    'fileHeader',
    'functionDocs',
    'notification',
    'ci',
  ];

  assert.deepEqual(CONFIGURABLE_FEATURES, [...registryFeatures, ...nonGateFeatures]);
  assert.equal(new Set(CONFIGURABLE_FEATURES).size, CONFIGURABLE_FEATURES.length);
});
