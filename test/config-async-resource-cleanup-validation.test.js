import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG } from '../src/config/defaults.js';
import { validateAsyncResourceCleanupConfiguration } from '../src/config/async-resource-cleanup-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies async resource cleanup defaults', () => {
  assert.deepEqual(
    validateAsyncResourceCleanupConfiguration({}, CONFIG_PATH),
    DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
  );
});

test('normalizes async resource cleanup scope and request functions', () => {
  assert.deepEqual(validateAsyncResourceCleanupConfiguration({
    asyncResourceCleanup: {
      enabled: true,
      include: ['packages/app/src/**'],
      exclude: [],
      extensions: ['.vue', '.ts'],
      timeoutThresholdMs: 2500,
      requestFunctions: ['fetch', 'http.request'],
    },
  }, CONFIG_PATH), {
    enabled: true,
    include: ['packages/app/src/**'],
    exclude: [],
    extensions: ['.vue', '.ts'],
    timeoutThresholdMs: 2500,
    requestFunctions: ['fetch', 'http.request'],
  });
});

test('rejects invalid async resource cleanup configuration', () => {
  assert.throws(
    () => validateAsyncResourceCleanupConfiguration({ asyncResourceCleanup: [] }, CONFIG_PATH),
    /asyncResourceCleanup 必须是对象/,
  );
  assert.throws(
    () => validateAsyncResourceCleanupConfiguration({
      asyncResourceCleanup: { timeoutThresholdMs: -1 },
    }, CONFIG_PATH),
    /timeoutThresholdMs 必须是大于或等于 0 的整数/,
  );
  assert.throws(
    () => validateAsyncResourceCleanupConfiguration({
      asyncResourceCleanup: { requestFunctions: ['api[method]'] },
    }, CONFIG_PATH),
    /必须是静态函数名或成员路径/,
  );
  assert.throws(
    () => validateAsyncResourceCleanupConfiguration({
      asyncResourceCleanup: { extensions: ['.html'] },
    }, CONFIG_PATH),
    /必须是受支持的文件扩展名/,
  );
});
