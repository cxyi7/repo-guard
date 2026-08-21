import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;
const PROFILE_NAME = /^[a-z][a-z0-9-]*$/;
const DURATION = /^([1-9]\d*)(ms|s|m|h)$/;
const MAX_VUS = 1000;
const MAX_ARRIVAL_RATE = 10000;
const MAX_DURATION_MS = 60 * 60 * 1000;
const RESERVED_ENVIRONMENT_NAMES = new Set([
  'REPO_GUARD_K6_RUN_ID',
  'K6_NO_USAGE_REPORT',
  'K6_AUTO_EXTENSION_RESOLUTION',
  'K6_NEW_MACHINE_READABLE_SUMMARY',
]);

function configError(code, message, details = {}) {
  return configurationError(`k6-load/${code}`, message, {
    expected: 'k6 压测配置必须完整、可验证，并且只能指向明确确认的 HTTPS 测试环境。',
    remediation: {
      goal: '修正 k6 压测配置后重新手动运行外部门禁。',
      steps: ['根据错误位置检查目标、负载配置、阈值、脚本路径和环境变量。'],
      constraints: ['不得放宽目标确认、负载上限、凭据隔离或手动运行限制。'],
      verification: ['重新运行 npm run guard:k6，并确认生成本次压测的新报告。'],
    },
    ...details,
  });
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configError('invalid-object', `${label} 必须是对象`);
  }
}

function assertKnownProperties(value, allowed, label) {
  const unknown = Object.keys(value).filter((property) => !allowed.has(property));
  if (unknown.length > 0) {
    throw configError('unknown-properties', `${label} 包含未知字段：${unknown.join('、')}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw configError('invalid-string', `${label} 必须是非空字符串`);
  }
  return value.trim();
}

function environmentName(value, label) {
  const normalized = nonEmptyString(value, label);
  if (!ENVIRONMENT_NAME.test(normalized)) {
    throw configError('invalid-environment-name', `${label} 必须是大写环境变量名称`);
  }
  return normalized;
}

function projectEnvironmentName(value, label) {
  const normalized = environmentName(value, label);
  if (normalized.startsWith('K6_') || RESERVED_ENVIRONMENT_NAMES.has(normalized)) {
    throw configError(
      'reserved-environment-name',
      `${label} 不得使用由 k6 或 runner 管理的环境变量名称`,
    );
  }
  return normalized;
}

function finiteNumber(value, label, { minimum, maximum }) {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < minimum || value > maximum) {
    throw configError('invalid-number', `${label} 必须介于 ${minimum} 到 ${maximum} 之间`);
  }
  return value;
}

function integer(value, label, limits) {
  const normalized = finiteNumber(value, label, limits);
  if (!Number.isInteger(normalized)) {
    throw configError('invalid-integer', `${label} 必须是整数`);
  }
  return normalized;
}

function duration(value, label, maximum = MAX_DURATION_MS) {
  const normalized = nonEmptyString(value, label);
  const match = normalized.match(DURATION);
  if (!match) {
    throw configError('invalid-duration', `${label} 必须使用正整数和 ms、s、m 或 h 单位`);
  }
  const amount = Number(match[1]);
  const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  const milliseconds = amount * multipliers[match[2]];
  if (!Number.isSafeInteger(milliseconds) || milliseconds > maximum) {
    throw configError('duration-too-large', `${label} 不得超过 ${maximum}ms`);
  }
  return Object.freeze({ text: normalized, milliseconds });
}

function repositoryFile(root, value, label, extensions) {
  const normalized = nonEmptyString(value, label);
  const segments = normalized.split('/');
  if (normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || !extensions.has(path.posix.extname(normalized).toLowerCase())) {
    throw configError(
      'invalid-repository-path',
      `${label} 必须是仓库内以 ${[...extensions].join(' 或 ')} 结尾的规范相对路径`,
    );
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)
    || !existsSync(target)
    || !lstatSync(target).isFile()
    || lstatSync(target).isSymbolicLink()) {
    throw configError('missing-repository-file', `${label} 不存在、不是常规文件或为符号链接：${normalized}`, {
      details: { location: { path: normalized } },
    });
  }
  return Object.freeze({ relative: normalized, target });
}

function readConfiguration(root, configFile) {
  const configPath = repositoryFile(root, configFile, 'k6 压测配置文件', new Set(['.json']));
  try {
    return Object.freeze({
      path: configPath,
      value: JSON.parse(readFileSync(configPath.target, 'utf8')),
    });
  } catch (error) {
    throw configError(
      'invalid-config-json',
      `k6 压测配置文件不是有效 JSON：${configPath.relative}`,
      { cause: error, details: { location: { path: configPath.relative } } },
    );
  }
}

function validateHost(value, label) {
  const host = nonEmptyString(value, label).toLowerCase();
  if (host.includes('*') || host.includes('/') || host.includes(':') || host.includes('@')) {
    throw configError('invalid-allowed-host', `${label} 必须是不含通配符、端口和协议的精确主机名`);
  }
  let parsed;
  try {
    parsed = new URL(`https://${host}`);
  } catch {
    throw configError('invalid-allowed-host', `${label} 不是有效主机名`);
  }
  if (parsed.hostname.toLowerCase() !== host || parsed.pathname !== '/') {
    throw configError('invalid-allowed-host', `${label} 必须是精确主机名`);
  }
  return host;
}

function validateTarget(value) {
  assertObject(value, 'target');
  assertKnownProperties(
    value,
    new Set(['baseUrlEnv', 'allowedHosts', 'confirmationEnv', 'requireHttps']),
    'target',
  );
  if (!Array.isArray(value.allowedHosts) || value.allowedHosts.length === 0) {
    throw configError('missing-allowed-hosts', 'target.allowedHosts 必须包含至少一个精确测试主机名');
  }
  const allowedHosts = value.allowedHosts.map((host, index) => (
    validateHost(host, `target.allowedHosts[${index}]`)
  ));
  if (new Set(allowedHosts).size !== allowedHosts.length) {
    throw configError('duplicate-allowed-hosts', 'target.allowedHosts 不得包含重复主机名');
  }
  if (value.requireHttps != null && value.requireHttps !== true) {
    throw configError('https-required', 'target.requireHttps 只能省略或设置为 true');
  }
  const baseUrlEnv = projectEnvironmentName(value.baseUrlEnv, 'target.baseUrlEnv');
  const confirmationEnv = projectEnvironmentName(value.confirmationEnv, 'target.confirmationEnv');
  if (baseUrlEnv === confirmationEnv) {
    throw configError('duplicate-target-environment', 'target.baseUrlEnv 与 confirmationEnv 不得相同');
  }
  return Object.freeze({
    baseUrlEnv,
    allowedHosts: Object.freeze(allowedHosts),
    confirmationEnv,
    requireHttps: true,
  });
}

function validateThresholds(value) {
  assertObject(value, 'thresholds');
  assertKnownProperties(
    value,
    new Set(['p95Ms', 'p99Ms', 'errorRate', 'checkRate', 'maxDroppedIterations']),
    'thresholds',
  );
  const thresholds = Object.freeze({
    p95Ms: finiteNumber(value.p95Ms, 'thresholds.p95Ms', { minimum: 1, maximum: 300000 }),
    p99Ms: finiteNumber(value.p99Ms, 'thresholds.p99Ms', { minimum: 1, maximum: 300000 }),
    errorRate: finiteNumber(value.errorRate, 'thresholds.errorRate', { minimum: 0, maximum: 1 }),
    checkRate: finiteNumber(value.checkRate, 'thresholds.checkRate', { minimum: 0, maximum: 1 }),
    maxDroppedIterations: integer(
      value.maxDroppedIterations ?? 0,
      'thresholds.maxDroppedIterations',
      { minimum: 0, maximum: 1000000 },
    ),
  });
  if (thresholds.p99Ms < thresholds.p95Ms) {
    throw configError('invalid-threshold-order', 'thresholds.p99Ms 不得小于 p95Ms');
  }
  return thresholds;
}

function validateRampingProfile(value, base) {
  assertKnownProperties(
    value,
    new Set(['name', 'executor', 'startVUs', 'stages', 'gracefulRampDown', 'gracefulStop']),
    'profile',
  );
  if (!Array.isArray(value.stages) || value.stages.length === 0 || value.stages.length > 20) {
    throw configError('invalid-stages', 'profile.stages 必须包含 1 到 20 个升降压阶段');
  }
  const stages = value.stages.map((stage, index) => {
    assertObject(stage, `profile.stages[${index}]`);
    assertKnownProperties(stage, new Set(['duration', 'target']), `profile.stages[${index}]`);
    return Object.freeze({
      duration: duration(stage.duration, `profile.stages[${index}].duration`),
      target: integer(stage.target, `profile.stages[${index}].target`, {
        minimum: 0,
        maximum: MAX_VUS,
      }),
    });
  });
  const totalDurationMs = stages.reduce((total, stage) => total + stage.duration.milliseconds, 0);
  if (totalDurationMs > MAX_DURATION_MS) {
    throw configError('profile-too-long', `profile.stages 总时长不得超过 ${MAX_DURATION_MS}ms`);
  }
  const gracefulRampDown = duration(
    value.gracefulRampDown ?? '30s',
    'profile.gracefulRampDown',
    5 * 60 * 1000,
  );
  const gracefulStop = duration(
    value.gracefulStop ?? '30s',
    'profile.gracefulStop',
    5 * 60 * 1000,
  );
  const startVUs = integer(value.startVUs ?? 0, 'profile.startVUs', {
    minimum: 0,
    maximum: MAX_VUS,
  });
  const maxVUs = Math.max(startVUs, ...stages.map((stage) => stage.target));
  if (maxVUs === 0) {
    throw configError('empty-load-profile', 'ramping-vus 配置必须至少有一个阶段的目标 VU 大于 0');
  }
  return Object.freeze({
    ...base,
    startVUs,
    stages: Object.freeze(stages),
    gracefulRampDown,
    gracefulStop,
    maxVUs,
    totalDurationMs,
    expectedMaxDurationMs: totalDurationMs + gracefulStop.milliseconds,
  });
}

function validateArrivalRateProfile(value, base) {
  assertKnownProperties(
    value,
    new Set([
      'name',
      'executor',
      'rate',
      'timeUnit',
      'duration',
      'preAllocatedVUs',
      'maxVUs',
      'gracefulStop',
    ]),
    'profile',
  );
  const profileDuration = duration(value.duration, 'profile.duration');
  const timeUnit = duration(value.timeUnit ?? '1s', 'profile.timeUnit', 60 * 1000);
  const preAllocatedVUs = integer(value.preAllocatedVUs, 'profile.preAllocatedVUs', {
    minimum: 1,
    maximum: MAX_VUS,
  });
  const maxVUs = integer(value.maxVUs, 'profile.maxVUs', {
    minimum: 1,
    maximum: MAX_VUS,
  });
  if (preAllocatedVUs > maxVUs) {
    throw configError('invalid-vu-allocation', 'profile.preAllocatedVUs 不得大于 maxVUs');
  }
  const gracefulStop = duration(
    value.gracefulStop ?? '30s',
    'profile.gracefulStop',
    5 * 60 * 1000,
  );
  return Object.freeze({
    ...base,
    rate: integer(value.rate, 'profile.rate', { minimum: 1, maximum: MAX_ARRIVAL_RATE }),
    timeUnit,
    duration: profileDuration,
    preAllocatedVUs,
    maxVUs,
    gracefulStop,
    totalDurationMs: profileDuration.milliseconds,
    expectedMaxDurationMs: profileDuration.milliseconds + gracefulStop.milliseconds,
  });
}

function validateProfile(value) {
  assertObject(value, 'profile');
  const name = nonEmptyString(value.name, 'profile.name');
  if (!PROFILE_NAME.test(name)) {
    throw configError('invalid-profile-name', 'profile.name 必须使用 kebab-case');
  }
  const executor = nonEmptyString(value.executor, 'profile.executor');
  const base = Object.freeze({ name, executor });
  if (executor === 'ramping-vus') return validateRampingProfile(value, base);
  if (executor === 'constant-arrival-rate') return validateArrivalRateProfile(value, base);
  throw configError(
    'unsupported-executor',
    'profile.executor 只支持 ramping-vus 或 constant-arrival-rate',
  );
}

function validateEnvironment(value = {}) {
  assertObject(value, 'environment');
  assertKnownProperties(value, new Set(['pass']), 'environment');
  const pass = value.pass ?? [];
  if (!Array.isArray(pass) || pass.length > 20) {
    throw configError('invalid-environment-pass-list', 'environment.pass 必须是最多包含 20 项的数组');
  }
  const names = pass.map((name, index) => (
    projectEnvironmentName(name, `environment.pass[${index}]`)
  ));
  if (new Set(names).size !== names.length) {
    throw configError('duplicate-environment-name', 'environment.pass 不得包含重复环境变量');
  }
  return Object.freeze({ pass: Object.freeze(names) });
}

function validateSafety(value = {}) {
  assertObject(value, 'safety');
  assertKnownProperties(value, new Set(['allowWrites']), 'safety');
  if (value.allowWrites != null && typeof value.allowWrites !== 'boolean') {
    throw configError('invalid-write-setting', 'safety.allowWrites 必须是布尔值');
  }
  return Object.freeze({ allowWrites: value.allowWrites ?? false });
}

function resolveTarget(target, profile, safety, environment) {
  const rawBaseUrl = environment[target.baseUrlEnv];
  if (typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) {
    throw configError('missing-base-url', `缺少 k6 测试目标环境变量 ${target.baseUrlEnv}`);
  }
  let url;
  try {
    url = new URL(rawBaseUrl.trim());
  } catch {
    throw configError('invalid-base-url', `${target.baseUrlEnv} 不是有效 URL`);
  }
  if (url.protocol !== 'https:') {
    throw configError('insecure-base-url', 'k6 压测目标必须使用 HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configError('unsafe-base-url', 'k6 压测目标不得包含凭据、查询参数或片段');
  }
  const hostname = url.hostname.toLowerCase();
  if (!target.allowedHosts.includes(hostname)) {
    throw configError('host-not-allowed', `k6 压测目标主机 ${hostname} 不在精确白名单中`);
  }
  const loadLabel = profile.executor === 'ramping-vus'
    ? `${profile.maxVUs}vus:${Math.ceil(profile.totalDurationMs / 1000)}s`
    : `${profile.maxVUs}vus:${profile.rate}/${profile.timeUnit.text}:${Math.ceil(profile.totalDurationMs / 1000)}s`;
  const expectedConfirmation = [
    hostname,
    profile.name,
    profile.executor,
    loadLabel,
    safety.allowWrites ? 'writes' : 'readonly',
  ].join(':');
  if (environment[target.confirmationEnv] !== expectedConfirmation) {
    throw configError(
      'load-not-confirmed',
      `必须将 ${target.confirmationEnv} 精确设置为 ${expectedConfirmation} 后才能运行 k6 压测`,
    );
  }
  return Object.freeze({
    baseURL: url.toString(),
    hostname,
    expectedConfirmation,
  });
}

function assertPassedEnvironment(environmentConfig, target, environment) {
  const blocked = environmentConfig.pass.filter((name) => (
    name === target.confirmationEnv || name === target.baseUrlEnv
  ));
  if (blocked.length > 0) {
    throw configError(
      'redundant-environment-name',
      `environment.pass 不得重复声明目标或确认变量：${blocked.join('、')}`,
    );
  }
  const missing = environmentConfig.pass.filter((name) => (
    typeof environment[name] !== 'string' || environment[name] === ''
  ));
  if (missing.length > 0) {
    throw configError('missing-passed-environment', `缺少 k6 脚本所需环境变量：${missing.join('、')}`);
  }
}

export function k6Options(configuration) {
  const { profile, thresholds } = configuration;
  const scenarioMetric = (name) => `${name}{scenario:${profile.name}}`;
  const scenario = profile.executor === 'ramping-vus'
    ? {
      executor: 'ramping-vus',
      startVUs: profile.startVUs,
      stages: profile.stages.map((stage) => ({
        duration: stage.duration.text,
        target: stage.target,
      })),
      gracefulRampDown: profile.gracefulRampDown.text,
      gracefulStop: profile.gracefulStop.text,
    }
    : {
      executor: 'constant-arrival-rate',
      rate: profile.rate,
      timeUnit: profile.timeUnit.text,
      duration: profile.duration.text,
      preAllocatedVUs: profile.preAllocatedVUs,
      maxVUs: profile.maxVUs,
      gracefulStop: profile.gracefulStop.text,
    };
  return Object.freeze({
    discardResponseBodies: true,
    setupTimeout: '60s',
    teardownTimeout: '60s',
    summaryTrendStats: Object.freeze(['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)']),
    thresholds: Object.freeze({
      [scenarioMetric('http_req_duration')]: Object.freeze([
        `p(95)<=${thresholds.p95Ms}`,
        `p(99)<=${thresholds.p99Ms}`,
      ]),
      [scenarioMetric('http_req_failed')]: Object.freeze([`rate<=${thresholds.errorRate}`]),
      [scenarioMetric('checks')]: Object.freeze([`rate>=${thresholds.checkRate}`]),
      [scenarioMetric('dropped_iterations')]: Object.freeze([
        `count<=${thresholds.maxDroppedIterations}`,
      ]),
      [scenarioMetric('http_reqs')]: Object.freeze(['count>0']),
      [scenarioMetric('iterations')]: Object.freeze(['count>0']),
    }),
    scenarios: Object.freeze({ [profile.name]: Object.freeze(scenario) }),
  });
}

export function loadK6Configuration(root, configFile, environment = process.env) {
  const source = readConfiguration(root, configFile);
  const value = source.value;
  assertObject(value, 'k6 压测配置');
  assertKnownProperties(
    value,
    new Set(['$schema', 'target', 'script', 'profile', 'thresholds', 'environment', 'safety']),
    'k6 压测配置',
  );
  if (value.$schema != null) nonEmptyString(value.$schema, 'k6 压测配置.$schema');
  const target = validateTarget(value.target);
  const profile = validateProfile(value.profile);
  const thresholds = validateThresholds(value.thresholds);
  const environmentConfig = validateEnvironment(value.environment);
  const safety = validateSafety(value.safety);
  const resolvedTarget = resolveTarget(target, profile, safety, environment);
  assertPassedEnvironment(environmentConfig, target, environment);
  const script = repositoryFile(root, value.script, 'script', new Set(['.js', '.ts']));
  return Object.freeze({
    source: source.path,
    target,
    resolvedTarget,
    script,
    profile,
    thresholds,
    environment: environmentConfig,
    safety,
  });
}
