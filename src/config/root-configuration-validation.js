import { configurationError } from '../core/error/repo-guard-error.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function assertProjectDocumentVersion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configValidationError('配置必须包含 JSON 对象');
  }
  if (value.version !== 2) {
    throw configurationError(
      'config/unsupported-version',
      '项目配置仅支持 version: 2；请按照当前配置规范重新建立配置，并显式声明项目身份。本版本不提供旧配置转换。',
    );
  }
}

export function validateRootConfigurationContract(value, configPath) {
  assertProjectDocumentVersion(value);
  assertKnownProperties(
    value,
    new Set([
      '$schema',
      'version',
      'project',
      'checks',
      'repository',
      'reporting',
      'ci',
    ]),
    configPath,
  );
}
