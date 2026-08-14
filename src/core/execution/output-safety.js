const DEFAULT_OUTPUT_LIMIT = 64 * 1024;
const REDACTION_MARKER = '[REDACTED]';

const PRIVATE_KEY_PATTERN = /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/gi;
const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(token|password|passwd|secret|cookie|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|session[-_]?id)\b\s*[:=]\s*([^\s,;]+)/gi;

export function containsSensitiveOutput(value) {
  const text = String(value);
  return /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i.test(text)
    || /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(text)
    || /["']?(?:token|password|passwd|secret|cookie|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|session[-_]?id)["']?\s*[:=]\s*["']?[^\s"',;}]+/i.test(text);
}

export function redactOutput(value) {
  return String(value)
    .replace(PRIVATE_KEY_PATTERN, '[REDACTED PRIVATE KEY]')
    .replace(BEARER_PATTERN, `$1 ${REDACTION_MARKER}`)
    .replace(SECRET_ASSIGNMENT_PATTERN, `$1=${REDACTION_MARKER}`);
}

function redactRoot(text, root) {
  if (typeof root !== 'string' || !root) return text;
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '');
  return text.replaceAll('\\', '/').replaceAll(normalizedRoot, '<repo>');
}

export function sanitizeProcessOutput(value, {
  root = null,
  limit = DEFAULT_OUTPUT_LIMIT,
} = {}) {
  const original = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
  const containedSensitiveData = containsSensitiveOutput(original)
    || original.includes(REDACTION_MARKER)
    || original.includes('[REDACTED PRIVATE KEY]');
  const safe = redactRoot(redactOutput(original), root);
  const truncated = Buffer.byteLength(safe, 'utf8') > limit;
  const text = truncated
    ? `${Buffer.from(safe, 'utf8').subarray(0, limit).toString('utf8')}\n[TRUNCATED after ${limit} bytes]`
    : safe;
  return Object.freeze({
    text,
    redacted: containedSensitiveData || text !== original,
    truncated,
  });
}

export const processOutputLimit = DEFAULT_OUTPUT_LIMIT;
