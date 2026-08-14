import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

export function parsePackageMetadata(source, label) {
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    throw configurationError(
      'dependency-policy/package-metadata-invalid-json',
      `${label} must contain valid JSON: ${error.message}`,
      {
        cause: error,
        details: { location: { path: label } },
        expected: `${label} contains valid JSON package metadata.`,
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
      `Unable to read ${label}: ${error.message}`,
      {
        cause: error,
        details: { location: { path: label } },
        expected: `${label} exists and is readable.`,
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
