import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRootConfigurationContract } from '../../src/config/root-configuration-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('accepts the complete set of supported root configuration properties', () => {
  assert.doesNotThrow(() =>
    validateRootConfigurationContract(
      {
        $schema: null,
        version: 2,
        project: null,
        checks: null,
        repository: null,
        reporting: null,
        ci: null,
      },
      CONFIG_PATH,
    ),
  );
});

test('requires the root configuration to be a JSON object', () => {
  for (const value of [null, [], 'invalid']) {
    assert.throws(
      () => validateRootConfigurationContract(value, CONFIG_PATH),
      /必须包含 JSON 对象/,
    );
  }
});

test('requires known root properties and configuration version 2', () => {
  assert.throws(
    () =>
      validateRootConfigurationContract(
        { version: 2, command: 'check' },
        CONFIG_PATH,
      ),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateRootConfigurationContract({ version: 3 }, CONFIG_PATH),
    { code: 'config/unsupported-version' },
  );
  assert.throws(
    () => validateRootConfigurationContract({ version: 1 }, CONFIG_PATH),
    {
      code: 'config/unsupported-version',
    },
  );
});
