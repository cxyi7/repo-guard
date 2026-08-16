import { DEFAULT_NOTIFICATION_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
} from './validation-primitives.js';

export function validateNotificationConfiguration(value, configPath) {
  const notificationValue = value.notification ?? {};
  if (
    !notificationValue
    || typeof notificationValue !== 'object'
    || Array.isArray(notificationValue)
  ) {
    throw configValidationError(`${configPath} notification 必须是对象`);
  }
  assertKnownProperties(
    notificationValue,
    new Set(['enabled']),
    `${configPath} notification`,
  );
  if (
    notificationValue.enabled != null
    && typeof notificationValue.enabled !== 'boolean'
  ) {
    throw configValidationError(`${configPath} notification.enabled 必须是布尔值`);
  }
  return {
    enabled: notificationValue.enabled ?? DEFAULT_NOTIFICATION_CONFIG.enabled,
  };
}
