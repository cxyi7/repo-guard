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
  featureName = null,
  featureOrder = null,
  configVersions = [1],
  environments,
  mutation,
  allowedMutations = [mutation],
  defaultTimeoutMs,
  requires = [],
  before = [],
  after = [],
  conflicts = [],
  manualCommand = null,
  manualOptions = [],
  manualOrder = null,
  doctorOrder = null,
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
  if (featureName != null) nonEmptyString(featureName, 'Gate featureName');
  if (featureName != null && configKey == null) {
    throw new TypeError('Gate featureName requires configKey');
  }
  if (featureName != null && featureOrder == null) {
    throw new TypeError('Gate featureName requires featureOrder');
  }
  for (const [value, label] of [
    [featureOrder, 'Gate featureOrder'],
    [doctorOrder, 'Gate doctorOrder'],
    [manualOrder, 'Gate manualOrder'],
  ]) {
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      throw new TypeError(`${label} must be a non-negative integer or null`);
    }
  }
  if (manualCommand != null) nonEmptyString(manualCommand, 'Gate manualCommand');
  if (manualCommand != null && manualOrder == null) {
    throw new TypeError('Gate manualCommand requires manualOrder');
  }
  if (packageScript != null && manualCommand == null) {
    throw new TypeError('Gate packageScript requires manualCommand');
  }
  if (packageScript != null) nonEmptyString(packageScript, 'Gate packageScript');
  if (!Array.isArray(configVersions)
    || configVersions.length === 0
    || configVersions.some((version) => !Number.isInteger(version) || version < 1)) {
    throw new TypeError('Gate configVersions must contain positive integers');
  }
  if (!MUTATIONS.includes(mutation)) {
    throw new TypeError(`Gate mutation must be one of: ${MUTATIONS.join(', ')}`);
  }
  const normalizedAllowedMutations = stringArray(
    allowedMutations,
    'Gate allowedMutations',
    MUTATIONS,
  );
  if (!normalizedAllowedMutations.includes(mutation)) {
    throw new TypeError('Gate allowedMutations must include its maximum mutation');
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
    featureName,
    featureOrder,
    configVersions: Object.freeze([...configVersions]),
    environments: stringArray(environments, 'Gate environments', ENVIRONMENTS),
    mutation,
    allowedMutations: normalizedAllowedMutations,
    defaultTimeoutMs,
    requires: stringArray(requires, 'Gate requires'),
    before: stringArray(before, 'Gate before'),
    after: stringArray(after, 'Gate after'),
    conflicts: stringArray(conflicts, 'Gate conflicts'),
    manualCommand,
    manualOptions: stringArray(manualOptions, 'Gate manualOptions'),
    manualOrder,
    doctorOrder,
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
