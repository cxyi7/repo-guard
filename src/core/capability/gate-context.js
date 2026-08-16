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
    throw new TypeError('ChangeSet source 必须是非空字符串');
  }
  if (!Array.isArray(changes)) throw new TypeError('ChangeSet changes 必须是数组');
  const normalizedRevision = revision == null ? null : deepFreeze({ ...revision });
  return Object.freeze({
    source,
    revision: normalizedRevision,
    entries: Object.freeze(changes.map(freezeChange)),
  });
}

export function changeSetEntries(value, label = '变更集') {
  if (value && Array.isArray(value.entries)) return value.entries;
  throw new TypeError(`${label} 必须是 ChangeSet`);
}

export function createStructuredLogger({ log, info, warn, error } = console) {
  for (const [level, handler] of Object.entries({ log, info, warn, error })) {
    if (typeof handler !== 'function') {
      throw new TypeError(`结构化日志方法 ${level} 必须是函数`);
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
    throw new TypeError('GateContext root 必须是非空字符串');
  }
  if (typeof environment !== 'string' || environment.trim() === '') {
    throw new TypeError('GateContext environment 必须是非空字符串');
  }
  if (!changes || !Array.isArray(changes.entries)) {
    throw new TypeError('GateContext changes 必须是 ChangeSet');
  }
  if (!Array.isArray(files)) throw new TypeError('GateContext files 必须是数组');
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError('GateContext signal 必须是 AbortSignal');
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
