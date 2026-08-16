import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError, toRepoGuardError } from '../core/error/repo-guard-error.js';
import { assertExceptionLifecycleCurrent } from './exception-lifecycle.js';
import { validateConfig } from './configuration-validation.js';
import { CONFIG_FILE } from './validation-primitives.js';

export function loadConfig(root, {
  allowExpiredExceptions = false,
  now = new Date(),
} = {}) {
  const configPath = path.join(root, CONFIG_FILE);
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw configurationError(
      'config/read-failed',
      `无法读取 ${CONFIG_FILE}：${error.message}`,
      {
        details: { location: { path: CONFIG_FILE } },
        expected: `${CONFIG_FILE} 必须位于仓库根目录，并包含有效的 JSON。`,
        remediation: {
          goal: `恢复可读取且有效的 ${CONFIG_FILE}.`,
          steps: ['按照文档中的 schema 创建或修正配置文件。'],
          constraints: ['不得通过删除必需的策略配置来绕过校验。'],
          verification: ['运行 npm run guard:check。'],
        },
        cause: error,
      },
    );
  }

  try {
    const config = validateConfig(parsed, CONFIG_FILE);
    if (!allowExpiredExceptions) {
      assertExceptionLifecycleCurrent(config.exceptions, { now });
    }
    return config;
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'configuration',
      code: 'config/invalid',
    });
  }
}
