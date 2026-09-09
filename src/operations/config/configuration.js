import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { validateOperationsConfig } from './validation.js';
import { assertOperationsFileLocation } from './file-location.js';

export { validateOperationsConfig } from './validation.js';
export const OPERATIONS_CONFIG_FILE = 'repo-guard.ops.json';

export function loadOperationsConfig(root) {
  assertOperationsFileLocation(root, OPERATIONS_CONFIG_FILE);
  const file = path.join(root, OPERATIONS_CONFIG_FILE);
  if (!existsSync(file)) {
    return validateOperationsConfig({ version: 2, enabled: false });
  }
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw configurationError('operations/unreadable-config', `${OPERATIONS_CONFIG_FILE} 不是有效的 JSON 配置`, { cause });
  }
  return validateOperationsConfig(document);
}

export function writeOperationsConfig(root, document, { expectedContent } = {}) {
  assertOperationsFileLocation(root, OPERATIONS_CONFIG_FILE);
  const normalized = validateOperationsConfig(document);
  const file = path.join(root, OPERATIONS_CONFIG_FILE);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current !== null && current !== expectedContent) {
    throw configurationError(
      'operations/config-conflict',
      `${OPERATIONS_CONFIG_FILE} 已存在或已变化，拒绝覆盖；请先读取并合并现有配置`,
    );
  }
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (current !== content) writeFileSync(file, content, { encoding: 'utf8', flag: current === null ? 'wx' : 'w' });
  return normalized;
}
