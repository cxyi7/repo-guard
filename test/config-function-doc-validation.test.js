import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FUNCTION_DOC_CONFIG,
  SUPPORTED_FUNCTION_DOC_EXTENSIONS,
} from '../src/config/defaults.js';
import { validateFunctionDocConfiguration } from '../src/config/function-doc-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('函数文档配置缺省时保持关闭并提供安全排除范围', () => {
  assert.deepEqual(
    validateFunctionDocConfiguration({}, CONFIG_PATH),
    DEFAULT_FUNCTION_DOC_CONFIG,
  );
});

test('规范化函数文档的目录范围、排除规则和扩展名白名单', () => {
  assert.deepEqual(validateFunctionDocConfiguration({
    functionDocs: {
      enabled: true,
      include: ['src/**'],
      exclude: ['src/generated/**'],
      extensions: ['.vue', '.ts', '.tsx'],
    },
  }, CONFIG_PATH), {
    enabled: true,
    include: ['src/**'],
    exclude: ['src/generated/**'],
    extensions: ['.vue', '.ts', '.tsx'],
  });
});

test('拒绝未知属性、空范围、重复扩展名和不受支持的扩展名', () => {
  assert.throws(
    () => validateFunctionDocConfiguration({ functionDocs: { mode: 'guess' } }, CONFIG_PATH),
    /包含不支持的属性： mode/,
  );
  assert.throws(
    () => validateFunctionDocConfiguration({ functionDocs: { include: [] } }, CONFIG_PATH),
    /include 必须是非空数组/,
  );
  assert.throws(
    () => validateFunctionDocConfiguration({
      functionDocs: { extensions: ['.ts', '.ts'] },
    }, CONFIG_PATH),
    /不得包含重复扩展名/,
  );
  assert.throws(
    () => validateFunctionDocConfiguration({ functionDocs: { extensions: ['.html'] } }, CONFIG_PATH),
    new RegExp(`必须是受支持的文件扩展名：${SUPPORTED_FUNCTION_DOC_EXTENSIONS.join(', ')}`),
  );
});

test('拒绝绝对路径、反向路径和取反模式', () => {
  for (const pattern of ['../src/**', '!src/generated/**', 'C:/project/src/**']) {
    assert.throws(
      () => validateFunctionDocConfiguration({ functionDocs: { include: [pattern] } }, CONFIG_PATH),
      /必须位于仓库内部/,
    );
  }
});
