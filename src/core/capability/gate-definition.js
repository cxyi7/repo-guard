const ENVIRONMENTS = [
  'manual',
  'pre-commit',
  'pre-push',
  'ci-policy',
  'ci-full',
  'release-ready',
];
const MUTATIONS = ['read-only', 'working-tree-fix', 'managed-files', 'external-write'];

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value, label, allowed = null) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} must be unique`);
  if (allowed && value.some((entry) => !allowed.includes(entry))) {
    throw new TypeError(`${label} contains an unsupported value`);
  }
  return Object.freeze([...value]);
}

export function defineGate({
  id,
  configKey = null,
  configVersions = [1],
  environments,
  mutation,
  defaultTimeoutMs,
  requires = [],
  before = [],
  after = [],
  conflicts = [],
  manualCommand = null,
  packageScript = null,
  rules = [],
  requiredTools = [],
  requiredScripts = [],
  requiredEnvironment = [],
  requiredSecrets = [],
  artifactTypes = [],
  supportsFix = false,
  supportsCancellation = false,
  inspectSetup,
  plan,
  run,
}) {
  nonEmptyString(id, 'Gate id');
  if (configKey != null) nonEmptyString(configKey, 'Gate configKey');
  if (manualCommand != null) nonEmptyString(manualCommand, 'Gate manualCommand');
  if (packageScript != null) nonEmptyString(packageScript, 'Gate packageScript');
  if (!Array.isArray(configVersions)
    || configVersions.length === 0
    || configVersions.some((version) => !Number.isInteger(version) || version < 1)) {
    throw new TypeError('Gate configVersions must contain positive integers');
  }
  if (!MUTATIONS.includes(mutation)) {
    throw new TypeError(`Gate mutation must be one of: ${MUTATIONS.join(', ')}`);
  }
  if (!Number.isInteger(defaultTimeoutMs) || defaultTimeoutMs < 1) {
    throw new TypeError('Gate defaultTimeoutMs must be a positive integer');
  }
  if (typeof supportsFix !== 'boolean' || typeof supportsCancellation !== 'boolean') {
    throw new TypeError('Gate supportsFix and supportsCancellation must be booleans');
  }
  if (typeof inspectSetup !== 'function'
    || typeof plan !== 'function'
    || typeof run !== 'function') {
    throw new TypeError('Gate inspectSetup, plan, and run must be functions');
  }
  return Object.freeze({
    id,
    configKey,
    configVersions: Object.freeze([...configVersions]),
    environments: stringArray(environments, 'Gate environments', ENVIRONMENTS),
    mutation,
    defaultTimeoutMs,
    requires: stringArray(requires, 'Gate requires'),
    before: stringArray(before, 'Gate before'),
    after: stringArray(after, 'Gate after'),
    conflicts: stringArray(conflicts, 'Gate conflicts'),
    manualCommand,
    packageScript,
    rules: stringArray(rules, 'Gate rules'),
    requiredTools: stringArray(requiredTools, 'Gate requiredTools'),
    requiredScripts: stringArray(requiredScripts, 'Gate requiredScripts'),
    requiredEnvironment: stringArray(requiredEnvironment, 'Gate requiredEnvironment'),
    requiredSecrets: stringArray(requiredSecrets, 'Gate requiredSecrets'),
    artifactTypes: stringArray(artifactTypes, 'Gate artifactTypes'),
    supportsFix,
    supportsCancellation,
    inspectSetup,
    plan,
    run,
  });
}
