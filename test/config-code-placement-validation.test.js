import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CODE_PLACEMENT_CONFIG } from '../src/config/defaults.js';
import { validateCodePlacementConfiguration } from '../src/config/code-placement-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('uses a disabled empty code placement policy by default', () => {
  assert.deepEqual(
    validateCodePlacementConfiguration({}, CONFIG_PATH),
    DEFAULT_CODE_PLACEMENT_CONFIG,
  );
});

test('normalizes exact code placement rules and line endings', () => {
  assert.deepEqual(validateCodePlacementConfiguration({
    codePlacement: {
      enabled: true,
      rules: [{
        name: '  支付签名  ',
        content: 'const value = 1;\r\nreturn value;\r\n',
        allowedFiles: ['src/payment/signature.ts'],
        scanPatterns: ['src/**/*.ts'],
      }],
    },
  }, CONFIG_PATH), {
    enabled: true,
    rules: [{
      name: '支付签名',
      content: 'const value = 1;\nreturn value;\n',
      allowedFiles: ['src/payment/signature.ts'],
      scanPatterns: ['src/**/*.ts'],
    }],
  });
});

test('rejects enabled policies without rules and unsafe rule values', () => {
  assert.throws(
    () => validateCodePlacementConfiguration({
      codePlacement: { enabled: true, rules: [] },
    }, CONFIG_PATH),
    /enabled 为 true 时 rules 必须至少包含一条规则/,
  );
  assert.throws(
    () => validateCodePlacementConfiguration({
      codePlacement: {
        enabled: true,
        rules: [{
          name: '越界规则',
          content: 'restrictedCode();',
          allowedFiles: ['../outside.js'],
          scanPatterns: ['src/**/*.js'],
        }],
      },
    }, CONFIG_PATH),
    /必须位于仓库内/,
  );
});
