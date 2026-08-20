import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FILE_HEADER_CONFIG,
  SUPPORTED_FILE_HEADER_EXTENSIONS,
} from '../src/config/defaults.js';
import { validateFileHeaderConfiguration } from '../src/config/file-header-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('文件头配置缺省时保持关闭并提供完整支持范围', () => {
  assert.deepEqual(
    validateFileHeaderConfiguration({}, CONFIG_PATH),
    DEFAULT_FILE_HEADER_CONFIG,
  );
});

test('规范化文件头的目录范围、排除规则和扩展名白名单', () => {
  assert.deepEqual(validateFileHeaderConfiguration({
    fileHeader: {
      enabled: true,
      include: ['src/**'],
      exclude: ['src/generated/**'],
      extensions: ['.vue', '.ts', '.scss'],
    },
  }, CONFIG_PATH), {
    enabled: true,
    include: ['src/**'],
    exclude: ['src/generated/**'],
    extensions: ['.vue', '.ts', '.scss'],
  });
});

test('拒绝未知属性、空范围、重复扩展名和不受支持的扩展名', () => {
  assert.throws(
    () => validateFileHeaderConfiguration({ fileHeader: { command: 'write' } }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateFileHeaderConfiguration({ fileHeader: { include: [] } }, CONFIG_PATH),
    /include 必须是非空数组/,
  );
  assert.throws(
    () => validateFileHeaderConfiguration({
      fileHeader: { extensions: ['.ts', '.ts'] },
    }, CONFIG_PATH),
    /不得包含重复扩展名/,
  );
  assert.throws(
    () => validateFileHeaderConfiguration({ fileHeader: { extensions: ['.md'] } }, CONFIG_PATH),
    new RegExp(`必须是受支持的文件扩展名：${SUPPORTED_FILE_HEADER_EXTENSIONS.join(', ')}`),
  );
});

test('拒绝绝对路径、反向路径和取反模式', () => {
  for (const pattern of ['../src/**', '!src/generated/**', 'C:/project/src/**']) {
    assert.throws(
      () => validateFileHeaderConfiguration({ fileHeader: { include: [pattern] } }, CONFIG_PATH),
      /必须位于仓库内部/,
    );
  }
});
