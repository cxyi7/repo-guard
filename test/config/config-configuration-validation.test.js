import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfigValue } from '../../src/config/configuration-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

function sparseConfig(extra = {}) {
  return {
    version: 2,
    project: {
      id: 'web',
      role: 'frontend',
      stack: 'node',
      preset: 'vue-javascript',
    },
    repository: {
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
      exclusions: [],
    },
    ...extra,
  };
}

test('assembles every normalized configuration domain in contract order', () => {
  const config = validateConfigValue(sparseConfig(), CONFIG_PATH);

  assert.deepEqual(Object.keys(config), [
    'version',
    'project',
    'checks',
    'repository',
    'reporting',
    'ci',
  ]);
  assert.equal(config.reporting.notification.enabled, true);
  assert.equal(config.repository.rules[0].pattern, 'src/**');
  assert.equal(config.repository.rules[0].matcher instanceof RegExp, true);
  assert.deepEqual(config.repository.exclusions, []);
});

test('preserves root, protected-file, and domain validation order', () => {
  assert.throws(
    () => validateConfigValue({ version: 2 }, CONFIG_PATH),
    /必须显式提供 project/,
  );
  assert.throws(
    () =>
      validateConfigValue(
        sparseConfig({
          repository: { rules: [] },
          reporting: { notification: [] },
        }),
        CONFIG_PATH,
      ),
    /必须至少定义一条规则/,
  );
  assert.throws(
    () =>
      validateConfigValue(
        sparseConfig({ reporting: { notification: [] } }),
        CONFIG_PATH,
      ),
    /notification 必须是对象/,
  );
});
