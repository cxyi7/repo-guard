const ENVIRONMENTS = [
  'manual',
  'pre-commit',
  'pre-push',
  'ci-policy',
  'ci-full',
  'release-ready',
];
const CI_ENVIRONMENTS = ['ci-policy', 'ci-full', 'release-ready'];
const MUTATIONS = ['read-only', 'working-tree-fix', 'managed-files', 'external-write'];

export const CI_GATE_POLICY_MODES = Object.freeze([
  'inherit',
  'off',
  'report',
  'enforce',
]);
export const CI_GATE_SCOPES = Object.freeze(['all-files', 'changed-files']);

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} 必须是非空字符串`);
  }
  return value;
}

function stringArray(value, label, allowed = null) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} 必须是字符串数组`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} 不得包含重复值`);
  if (allowed && value.some((entry) => !allowed.includes(entry))) {
    throw new TypeError(`${label} 包含不支持的值`);
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
  ciScopes = null,
  supportsFix = false,
  supportsCancellation = false,
  inspectSetup,
  plan,
  run,
}) {
  nonEmptyString(id, '门禁 id');
  if (configKey != null) nonEmptyString(configKey, '门禁 configKey');
  if (featureName != null) nonEmptyString(featureName, '门禁 featureName');
  if (featureName != null && configKey == null) {
    throw new TypeError('门禁设置 featureName 时必须同时设置 configKey');
  }
  if (featureName != null && featureOrder == null) {
    throw new TypeError('门禁设置 featureName 时必须同时设置 featureOrder');
  }
  for (const [value, label] of [
    [featureOrder, '门禁 featureOrder'],
    [doctorOrder, '门禁 doctorOrder'],
    [manualOrder, '门禁 manualOrder'],
  ]) {
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      throw new TypeError(`${label} 必须是非负整数或 null`);
    }
  }
  if (manualCommand != null) nonEmptyString(manualCommand, '门禁 manualCommand');
  if (manualCommand != null && manualOrder == null) {
    throw new TypeError('门禁设置 manualCommand 时必须同时设置 manualOrder');
  }
  if (packageScript != null && manualCommand == null) {
    throw new TypeError('门禁设置 packageScript 时必须同时设置 manualCommand');
  }
  if (packageScript != null) nonEmptyString(packageScript, '门禁 packageScript');
  if (!Array.isArray(configVersions)
    || configVersions.length === 0
    || configVersions.some((version) => !Number.isInteger(version) || version < 1)) {
    throw new TypeError('门禁 configVersions 必须只包含正整数');
  }
  if (!MUTATIONS.includes(mutation)) {
    throw new TypeError(`门禁 mutation 必须是以下值之一： ${MUTATIONS.join(', ')}`);
  }
  const normalizedAllowedMutations = stringArray(
    allowedMutations,
    '门禁 allowedMutations',
    MUTATIONS,
  );
  if (!normalizedAllowedMutations.includes(mutation)) {
    throw new TypeError('门禁 allowedMutations 必须包含其最高变更级别');
  }
  if (!Number.isInteger(defaultTimeoutMs) || defaultTimeoutMs < 1) {
    throw new TypeError('门禁 defaultTimeoutMs 必须是正整数');
  }
  if (typeof supportsFix !== 'boolean' || typeof supportsCancellation !== 'boolean') {
    throw new TypeError('门禁 supportsFix 和 supportsCancellation 必须是布尔值');
  }
  if (typeof inspectSetup !== 'function'
    || typeof plan !== 'function'
    || typeof run !== 'function') {
    throw new TypeError('门禁 inspectSetup、plan 和 run 必须是函数');
  }
  const normalizedEnvironments = stringArray(
    environments,
    '门禁 environments',
    ENVIRONMENTS,
  );
  const supportsCi = normalizedEnvironments.some((environment) => (
    CI_ENVIRONMENTS.includes(environment)
  ));
  if (!supportsCi && ciScopes != null) {
    throw new TypeError('门禁 ciScopes 仅可用于 CI 门禁');
  }
  const normalizedCiScopes = supportsCi
    ? stringArray(ciScopes ?? ['all-files'], '门禁 ciScopes', CI_GATE_SCOPES)
    : Object.freeze([]);
  if (supportsCi && normalizedCiScopes.length === 0) {
    throw new TypeError('CI 门禁 ciScopes 至少要包含一个支持的范围');
  }
  if (supportsCi && !normalizedCiScopes.includes('all-files')) {
    throw new TypeError('CI 门禁 ciScopes 必须包含默认范围 all-files');
  }
  return Object.freeze({
    id,
    resultModel: 'GateResult',
    configKey,
    featureName,
    featureOrder,
    configVersions: Object.freeze([...configVersions]),
    environments: normalizedEnvironments,
    mutation,
    allowedMutations: normalizedAllowedMutations,
    defaultTimeoutMs,
    requires: stringArray(requires, '门禁 requires'),
    before: stringArray(before, '门禁 before'),
    after: stringArray(after, '门禁 after'),
    conflicts: stringArray(conflicts, '门禁 conflicts'),
    manualCommand,
    manualOptions: stringArray(manualOptions, '门禁 manualOptions'),
    manualOrder,
    doctorOrder,
    packageScript,
    rules: stringArray(rules, '门禁 rules'),
    requiredTools: stringArray(requiredTools, '门禁 requiredTools'),
    requiredScripts: stringArray(requiredScripts, '门禁 requiredScripts'),
    requiredEnvironment: stringArray(requiredEnvironment, '门禁 requiredEnvironment'),
    requiredSecrets: stringArray(requiredSecrets, '门禁 requiredSecrets'),
    artifactTypes: stringArray(artifactTypes, '门禁 artifactTypes'),
    ciScopes: normalizedCiScopes,
    supportsFix,
    supportsCancellation,
    inspectSetup,
    plan,
    run,
  });
}
