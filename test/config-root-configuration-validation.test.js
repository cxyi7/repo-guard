import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRootConfigurationContract } from '../src/config/root-configuration-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('accepts the complete set of supported root configuration properties', () => {
  assert.doesNotThrow(() => validateRootConfigurationContract({
    $schema: null,
    version: 1,
    notification: null,
    ci: null,
    externalGates: null,
    codePlacement: null,
    exceptions: null,
    dependencyPolicy: null,
    commitMessage: null,
    deadCode: null,
    architecture: null,
    accessibilityTest: null,
    build: null,
    mutationTest: null,
    lighthouse: null,
    typeCheck: null,
    unitTest: null,
    preCommit: null,
    rules: null,
    exclusions: null,
  }, CONFIG_PATH));
});

test('requires the root configuration to be a JSON object', () => {
  for (const value of [null, [], 'invalid']) {
    assert.throws(
      () => validateRootConfigurationContract(value, CONFIG_PATH),
      /必须包含 JSON 对象/,
    );
  }
});

test('requires known root properties and configuration version 1', () => {
  assert.throws(
    () => validateRootConfigurationContract({ version: 1, command: 'check' }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateRootConfigurationContract({ version: 2 }, CONFIG_PATH),
    /使用了不支持的版本： 2/,
  );
});
