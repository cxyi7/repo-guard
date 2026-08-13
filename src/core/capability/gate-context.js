function freezeChange(change) {
  return Object.freeze({
    ...change,
    ...(Array.isArray(change.states) ? { states: Object.freeze([...change.states]) } : {}),
  });
}

function deepFreeze(value, seen = new Set()) {
  if (value == null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  if (seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createChangeSet({ source, changes = [], revision = null }) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('ChangeSet source must be a non-empty string');
  }
  if (!Array.isArray(changes)) throw new TypeError('ChangeSet changes must be an array');
  const normalizedRevision = revision == null ? null : deepFreeze({ ...revision });
  return Object.freeze({
    source,
    revision: normalizedRevision,
    entries: Object.freeze(changes.map(freezeChange)),
  });
}

export function changeSetEntries(value, label = 'ChangeSet') {
  if (value && Array.isArray(value.entries)) return value.entries;
  throw new TypeError(`${label} must be a ChangeSet`);
}

export function createStructuredLogger({ log, info, warn, error } = console) {
  for (const [level, handler] of Object.entries({ log, info, warn, error })) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Structured logger ${level} must be a function`);
    }
  }
  return Object.freeze({
    log: (...values) => log(...values),
    info: (...values) => info(...values),
    warn: (...values) => warn(...values),
    error: (...values) => error(...values),
  });
}

export function createGateContext({
  root,
  environment,
  config,
  changes,
  revision = changes?.revision ?? null,
  signal = new AbortController().signal,
  artifactDirectory = null,
  logger = createStructuredLogger(),
  files = [],
}) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError('GateContext root must be a non-empty string');
  }
  if (typeof environment !== 'string' || environment.trim() === '') {
    throw new TypeError('GateContext environment must be a non-empty string');
  }
  if (!changes || !Array.isArray(changes.entries)) {
    throw new TypeError('GateContext changes must be a ChangeSet');
  }
  if (!Array.isArray(files)) throw new TypeError('GateContext files must be an array');
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError('GateContext signal must be an AbortSignal');
  }
  return Object.freeze({
    root,
    environment,
    config: deepFreeze(config),
    changes,
    revision,
    signal,
    artifactDirectory,
    logger,
    files: Object.freeze([...files]),
  });
}
