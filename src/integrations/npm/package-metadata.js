import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

export function parsePackageMetadata(source, label) {
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    throw configurationError(
      'dependency-policy/package-metadata-invalid-json',
      `${label} 必须包含有效 JSON：${error.message}`,
      {
        cause: error,
        details: { location: { path: label } },
        expected: `${label} 包含有效的 JSON 包元数据。`,
      },
    );
  }
}

export function readPackageMetadataFile(root, label) {
  const target = path.join(root, label);
  let source;
  try {
    source = readFileSync(target, 'utf8');
  } catch (error) {
    throw configurationError(
      'dependency-policy/package-metadata-read-failed',
      `无法读取 ${label}：${error.message}`,
      {
        cause: error,
        details: { location: { path: label } },
        expected: `${label} 存在且可读取。`,
      },
    );
  }
  return parsePackageMetadata(source, label);
}

export function readOptionalPackageMetadataFile(root, label) {
  return existsSync(path.join(root, label))
    ? readPackageMetadataFile(root, label)
    : null;
}
