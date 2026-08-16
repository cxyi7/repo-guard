import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BUILD_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
} from '../src/config/defaults.js';
import { validateExecutionGateConfiguration } from '../src/config/execution-gate-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies external execution gate defaults when configuration is omitted', () => {
  assert.deepEqual(validateExecutionGateConfiguration({}, CONFIG_PATH), {
    build: DEFAULT_BUILD_CONFIG,
    lighthouse: DEFAULT_LIGHTHOUSE_CONFIG,
    typeCheck: DEFAULT_TYPE_CHECK_CONFIG,
  });
});

test('normalizes build, Lighthouse, and TypeScript execution settings', () => {
  const result = validateExecutionGateConfiguration({
    build: {
      enabled: true,
      script: ' build:prod ',
      timeoutMs: 240000,
    },
    lighthouse: {
      enabled: true,
      configFile: ' config/lighthouserc.cjs ',
      buildScript: null,
      timeoutMs: 180000,
    },
    typeCheck: {
      enabled: true,
      script: ' typecheck:vue ',
      timeoutMs: 90000,
    },
  }, CONFIG_PATH);

  assert.deepEqual(result, {
    build: {
      enabled: true,
      script: 'build:prod',
      timeoutMs: 240000,
    },
    lighthouse: {
      enabled: true,
      configFile: 'config/lighthouserc.cjs',
      buildScript: null,
      timeoutMs: 180000,
    },
    typeCheck: {
      enabled: true,
      script: 'typecheck:vue',
      timeoutMs: 90000,
    },
  });
});

test('requires execution gate objects and boolean switches', () => {
  assert.throws(
    () => validateExecutionGateConfiguration({ build: [] }, CONFIG_PATH),
    /build 必须是对象/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      lighthouse: { enabled: 'yes' },
    }, CONFIG_PATH),
    /lighthouse\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({ typeCheck: 'invalid' }, CONFIG_PATH),
    /typeCheck 必须是对象/,
  );
});

test('rejects invalid scripts, paths, and timeouts', () => {
  assert.throws(
    () => validateExecutionGateConfiguration({
      build: { script: 'npm run build' },
    }, CONFIG_PATH),
    /build\.script 必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      lighthouse: { configFile: '  ' },
    }, CONFIG_PATH),
    /lighthouse\.configFile 必须为 null 或非空字符串/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      typeCheck: { timeoutMs: 0 },
    }, CONFIG_PATH),
    /typeCheck\.timeoutMs 必须是正整数/,
  );
});
