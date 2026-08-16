import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfigValue } from '../src/config/configuration-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

function sparseConfig(extra = {}) {
  return {
    version: 1,
    rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
    exclusions: [],
    ...extra,
  };
}

test('assembles every normalized configuration domain in contract order', () => {
  const config = validateConfigValue(sparseConfig(), CONFIG_PATH);

  assert.deepEqual(Object.keys(config), [
    'version',
    'notification',
    'ci',
    'externalGates',
    'codePlacement',
    'exceptions',
    'dependencyPolicy',
    'architecture',
    'build',
    'lighthouse',
    'typeCheck',
    'accessibilityTest',
    'unitTest',
    'preCommit',
    'rules',
    'exclusions',
  ]);
  assert.equal(config.notification.enabled, true);
  assert.equal(config.rules[0].pattern, 'src/**');
  assert.equal(config.rules[0].matcher instanceof RegExp, true);
  assert.deepEqual(config.exclusions, []);
});

test('preserves root, protected-file, and domain validation order', () => {
  assert.throws(
    () => validateConfigValue({ version: 2 }, CONFIG_PATH),
    /使用了不支持的版本： 2/,
  );
  assert.throws(
    () => validateConfigValue({ version: 1, notification: [] }, CONFIG_PATH),
    /必须至少定义一条规则/,
  );
  assert.throws(
    () => validateConfigValue(sparseConfig({ notification: [] }), CONFIG_PATH),
    /notification 必须是对象/,
  );
});
