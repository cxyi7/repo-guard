import { internalError } from '../core/error/repo-guard-error.js';

export function configuredGateTimeout(gate, context) {
  const configuration = gate.configKey?.split('.').reduce(
    (current, key) => current?.[key], context.config,
  );
  const timeoutMs = configuration?.timeoutMs ?? gate.defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw internalError('orchestration/invalid-timeout', `门禁 ${gate.id} 的执行时限无效`);
  }
  return timeoutMs;
}
