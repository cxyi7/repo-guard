import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_NOTIFICATION_CONFIG } from '../src/config/defaults.js';
import { validateNotificationConfiguration } from '../src/config/notification-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies notification defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateNotificationConfiguration({}, CONFIG_PATH),
    DEFAULT_NOTIFICATION_CONFIG,
  );
});

test('normalizes the project notification switch', () => {
  assert.deepEqual(validateNotificationConfiguration({
    notification: { enabled: false },
  }, CONFIG_PATH), {
    enabled: false,
  });
});

test('requires a notification object with a boolean switch', () => {
  assert.throws(
    () => validateNotificationConfiguration({ notification: [] }, CONFIG_PATH),
    /notification must be an object/,
  );
  assert.throws(
    () => validateNotificationConfiguration({
      notification: { webhook: 'https://example.com' },
    }, CONFIG_PATH),
    /notification has unsupported properties: webhook/,
  );
  assert.throws(
    () => validateNotificationConfiguration({
      notification: { enabled: 'yes' },
    }, CONFIG_PATH),
    /notification\.enabled must be a boolean/,
  );
});
