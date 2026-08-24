import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeadCodeConfiguration } from '../src/config/dead-code-validation.js';
import { DEFAULT_DEAD_CODE_CONFIG } from '../src/config/defaults.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('未配置时使用安全的无效代码默认值', () => {
  assert.deepEqual(
    validateDeadCodeConfiguration({}, CONFIG_PATH),
    DEFAULT_DEAD_CODE_CONFIG,
  );
});

test('规范化 Knip 配置、基线路径和问题类型', () => {
  assert.deepEqual(validateDeadCodeConfiguration({
    deadCode: {
      enabled: true,
      mode: 'noRegression',
      configFile: ' config\\knip.ts ',
      baselineFile: ' quality\\knip-baseline.json ',
      timeoutMs: 90000,
      production: true,
      issueTypes: ['files', 'exports', 'unlisted'],
      treatConfigHintsAsErrors: true,
    },
  }, CONFIG_PATH), {
    enabled: true,
    mode: 'noRegression',
    configFile: 'config/knip.ts',
    baselineFile: 'quality/knip-baseline.json',
    timeoutMs: 90000,
    production: true,
    issueTypes: ['files', 'unlisted', 'exports'],
    treatConfigHintsAsErrors: true,
  });
});

test('拒绝未知模式、重复类型、越界路径和弱化配置提示', () => {
  assert.throws(
    () => validateDeadCodeConfiguration({ deadCode: { mode: 'baseline' } }, CONFIG_PATH),
    /strict.*noRegression/,
  );
  assert.throws(
    () => validateDeadCodeConfiguration({
      deadCode: { issueTypes: ['files', 'files'] },
    }, CONFIG_PATH),
    /issueTypes.*重复/,
  );
  assert.throws(
    () => validateDeadCodeConfiguration({
      deadCode: { baselineFile: '../outside.json' },
    }, CONFIG_PATH),
    /仓库内部/,
  );
  assert.throws(
    () => validateDeadCodeConfiguration({
      deadCode: { treatConfigHintsAsErrors: false },
    }, CONFIG_PATH),
    /treatConfigHintsAsErrors.*true/,
  );
});
