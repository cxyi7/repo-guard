const ERROR_KINDS = Object.freeze([
  'configuration',
  'execution',
  'range',
  'security',
  'internal',
  'cancellation',
]);

const STATUS_BY_KIND = Object.freeze({
  configuration: 'configuration-error',
  execution: 'execution-error',
  range: 'range-error',
  security: 'execution-error',
  internal: 'execution-error',
  cancellation: 'execution-error',
});

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} 必须是非空字符串`);
  }
  return value;
}

export class RepoGuardError extends Error {
  constructor(message, {
    code,
    kind = 'execution',
    details = null,
    expected = null,
    remediation = null,
    decision = null,
    cause,
  } = {}) {
    super(requireText(message, 'RepoGuardError 消息'), cause === undefined ? undefined : { cause });
    requireText(code, 'RepoGuardError 代码');
    if (!ERROR_KINDS.includes(kind)) {
      throw new TypeError(`RepoGuardError kind 必须是以下值之一： ${ERROR_KINDS.join(', ')}`);
    }
    this.name = 'RepoGuardError';
    this.code = code;
    this.kind = kind;
    this.details = details;
    this.expected = expected;
    this.remediation = remediation;
    this.decision = decision;
  }
}

export function isRepoGuardError(error) {
  return error instanceof RepoGuardError;
}

export function errorStatus(error, fallbackKind = 'execution') {
  const kind = isRepoGuardError(error) || ERROR_KINDS.includes(error?.kind)
    ? error.kind
    : fallbackKind;
  return STATUS_BY_KIND[kind] ?? STATUS_BY_KIND.execution;
}

export function toRepoGuardError(error, {
  code,
  kind = 'execution',
  message,
  details,
  expected,
  remediation,
  decision,
} = {}) {
  if (isRepoGuardError(error)) return error;
  const originalMessage = typeof error?.message === 'string' && error.message
    ? error.message
    : String(error);
  return new RepoGuardError(message ?? originalMessage, {
    code: code ?? (typeof error?.code === 'string' && error.code ? error.code : `${kind}/unknown`),
    kind,
    details,
    expected,
    remediation,
    decision,
    cause: error instanceof Error ? error : undefined,
  });
}

export function configurationError(code, message, options = {}) {
  return new RepoGuardError(message, { ...options, code, kind: 'configuration' });
}

export function executionError(code, message, options = {}) {
  return new RepoGuardError(message, { ...options, code, kind: 'execution' });
}

export function rangeError(code, message, options = {}) {
  return new RepoGuardError(message, { ...options, code, kind: 'range' });
}

export function securityError(code, message, options = {}) {
  return new RepoGuardError(message, { ...options, code, kind: 'security' });
}

export function internalError(code, message, options = {}) {
  return new RepoGuardError(message, { ...options, code, kind: 'internal' });
}

export function cancellationError(code, message, options = {}) {
  return new RepoGuardError(message, { ...options, code, kind: 'cancellation' });
}
