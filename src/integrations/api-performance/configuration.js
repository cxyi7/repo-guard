import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configurationError } from '../../core/error/repo-guard-error.js';

const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_METHODS = new Set([...SAFE_METHODS, ...WRITE_METHODS]);
const CONFIG_PROPERTIES = new Set([
  '$schema',
  'target',
  'client',
  'scenarios',
  'execution',
  'thresholds',
  'safety',
]);

function configError(code, message, details = {}) {
  return configurationError(`api-performance/${code}`, message, {
    expected: '接口性能测试配置必须完整、可验证，并且只能指向明确确认的 HTTPS 测试环境。',
    remediation: {
      goal: '修正接口性能测试配置后重新手动运行外部门禁。',
      steps: ['根据错误位置检查配置字段、场景模块和环境变量。'],
      constraints: ['不得通过关闭目标环境确认、放宽写请求限制或提交凭据绕过校验。'],
      verification: ['重新运行 npm run guard:api-performance，并确认生成本次测试的新报告。'],
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

function repositoryModulePath(root, value, label) {
  const normalized = nonEmptyString(value, label);
  const segments = normalized.split('/');
  if (normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || path.posix.extname(normalized) !== '.mjs') {
    throw configError('invalid-module-path', `${label} 必须是仓库内以 .mjs 结尾的规范相对路径`);
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)
    || !existsSync(target)
    || !lstatSync(target).isFile()
    || lstatSync(target).isSymbolicLink()) {
    throw configError('missing-module', `${label} 不存在、不是常规文件或为符号链接：${normalized}`, {
      details: { location: { path: normalized } },
    });
  }
  return Object.freeze({ relative: normalized, target });
}

function repositoryConfigPath(root, value) {
  const normalized = nonEmptyString(value, '性能测试配置文件');
  const segments = normalized.split('/');
  if (normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || path.posix.extname(normalized) !== '.json') {
    throw configError(
      'invalid-config-path',
      '性能测试配置文件必须是仓库内以 .json 结尾的规范相对路径',
    );
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)
    || !existsSync(target)
    || !lstatSync(target).isFile()
    || lstatSync(target).isSymbolicLink()) {
    throw configError('missing-config', `性能测试配置文件不存在、不是常规文件或为符号链接：${normalized}`, {
      details: { location: { path: normalized } },
    });
  }
  return Object.freeze({ relative: normalized, target });
}

function readConfigurationFile(configPath) {
  try {
    return JSON.parse(readFileSync(configPath.target, 'utf8'));
  } catch (error) {
    throw configError(
      'invalid-config-json',
      `性能测试配置文件不是有效 JSON：${configPath.relative}`,
      { cause: error, details: { location: { path: configPath.relative } } },
    );
  }
}

async function importProjectModule(modulePath, label) {
  try {
    return await import(`${pathToFileURL(modulePath.target).href}?repoGuard=${Date.now()}`);
  } catch (error) {
    throw configError(
      'module-load-failed',
      `无法加载${label}：${modulePath.relative}`,
      { cause: error, details: { location: { path: modulePath.relative } } },
    );
  }
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

function validateThresholds(value, label, fallback = null) {
  const candidate = value ?? fallback;
  assertObject(candidate, label);
  assertKnownProperties(candidate, new Set(['p95Ms', 'p99Ms', 'errorRate']), label);
  for (const property of ['p95Ms', 'p99Ms', 'errorRate']) {
    if (!Object.hasOwn(candidate, property)) {
      throw configError('missing-threshold', `${label}.${property} 为必填项`);
    }
  }
  const thresholds = Object.freeze({
    p95Ms: finiteNumber(candidate.p95Ms, `${label}.p95Ms`, { minimum: 1, maximum: 300000 }),
    p99Ms: finiteNumber(candidate.p99Ms, `${label}.p99Ms`, { minimum: 1, maximum: 300000 }),
    errorRate: finiteNumber(candidate.errorRate, `${label}.errorRate`, { minimum: 0, maximum: 1 }),
  });
  if (thresholds.p99Ms < thresholds.p95Ms) {
    throw configError('invalid-threshold-order', `${label}.p99Ms 不得小于 p95Ms`);
  }
  return thresholds;
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
  return Object.freeze({
    baseUrlEnv: environmentName(value.baseUrlEnv, 'target.baseUrlEnv'),
    allowedHosts: Object.freeze(allowedHosts),
    confirmationEnv: environmentName(value.confirmationEnv, 'target.confirmationEnv'),
    requireHttps: true,
  });
}

function validateClient(root, value) {
  assertObject(value, 'client');
  assertKnownProperties(value, new Set(['module', 'exportName']), 'client');
  const exportName = value.exportName == null
    ? 'createPerformanceClient'
    : nonEmptyString(value.exportName, 'client.exportName');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    throw configError('invalid-export-name', 'client.exportName 必须是有效的 JavaScript 导出名称');
  }
  return Object.freeze({
    module: repositoryModulePath(root, value.module, 'client.module'),
    exportName,
  });
}

function validateExecution(value = {}) {
  assertObject(value, 'execution');
  assertKnownProperties(value, new Set(['warmupIterations', 'iterations', 'concurrency']), 'execution');
  return Object.freeze({
    warmupIterations: integer(
      value.warmupIterations ?? 2,
      'execution.warmupIterations',
      { minimum: 1, maximum: 20 },
    ),
    iterations: integer(
      value.iterations ?? 10,
      'execution.iterations',
      { minimum: 10, maximum: 10000 },
    ),
    concurrency: integer(
      value.concurrency ?? 1,
      'execution.concurrency',
      { minimum: 1, maximum: 5 },
    ),
  });
}

function validateSafety(value = {}) {
  assertObject(value, 'safety');
  assertKnownProperties(value, new Set(['allowWrites']), 'safety');
  if (value.allowWrites != null && typeof value.allowWrites !== 'boolean') {
    throw configError('invalid-write-setting', 'safety.allowWrites 必须是布尔值');
  }
  return Object.freeze({ allowWrites: value.allowWrites ?? false });
}

function validateScenarioModule(module, modulePath, defaultThresholds, safety) {
  const scenario = module.default;
  assertObject(scenario, `场景 ${modulePath.relative} 的默认导出`);
  assertKnownProperties(
    scenario,
    new Set(['name', 'method', 'pathLabel', 'run', 'cleanup', 'allowWrites', 'thresholds']),
    `场景 ${modulePath.relative}`,
  );
  const name = nonEmptyString(scenario.name, `场景 ${modulePath.relative}.name`);
  if (name.length > 100) throw configError('scenario-name-too-long', `场景名称不得超过 100 个字符：${modulePath.relative}`);
  const method = nonEmptyString(scenario.method, `场景 ${modulePath.relative}.method`).toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw configError('unsupported-method', `场景 ${modulePath.relative} 使用了不支持的请求方法：${method}`);
  }
  const pathLabel = nonEmptyString(scenario.pathLabel, `场景 ${modulePath.relative}.pathLabel`);
  if (!pathLabel.startsWith('/') || pathLabel.includes('?') || pathLabel.includes('#')
    || /\s/.test(pathLabel) || pathLabel.length > 200) {
    throw configError(
      'unsafe-path-label',
      `场景 ${modulePath.relative}.pathLabel 必须是不含查询参数、片段和空白的路径标签`,
    );
  }
  if (typeof scenario.run !== 'function') {
    throw configError('missing-scenario-runner', `场景 ${modulePath.relative}.run 必须是函数`);
  }
  const isWrite = WRITE_METHODS.has(method);
  if (isWrite && (!safety.allowWrites || scenario.allowWrites !== true)) {
    throw configError(
      'write-request-not-authorized',
      `写请求场景 ${modulePath.relative} 必须同时启用 safety.allowWrites 和 allowWrites`,
    );
  }
  if (isWrite && typeof scenario.cleanup !== 'function') {
    throw configError('missing-write-cleanup', `写请求场景 ${modulePath.relative} 必须提供 cleanup 函数`);
  }
  if (!isWrite && scenario.allowWrites != null) {
    throw configError('unexpected-write-authorization', `只读场景 ${modulePath.relative} 不得声明 allowWrites`);
  }
  if (!isWrite && scenario.cleanup != null && typeof scenario.cleanup !== 'function') {
    throw configError('invalid-cleanup', `场景 ${modulePath.relative}.cleanup 必须是函数`);
  }
  return Object.freeze({
    name,
    method,
    pathLabel,
    run: scenario.run,
    cleanup: scenario.cleanup ?? null,
    isWrite,
    modulePath: modulePath.relative,
    thresholds: validateThresholds(
      scenario.thresholds,
      `场景 ${modulePath.relative}.thresholds`,
      defaultThresholds,
    ),
  });
}

export function resolveApiPerformanceTarget(target, environment = process.env) {
  const rawBaseUrl = environment[target.baseUrlEnv];
  if (typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) {
    throw configError('missing-base-url', `缺少测试目标环境变量 ${target.baseUrlEnv}`);
  }
  let url;
  try {
    url = new URL(rawBaseUrl.trim());
  } catch {
    throw configError('invalid-base-url', `${target.baseUrlEnv} 不是有效 URL`);
  }
  if (url.protocol !== 'https:') {
    throw configError('insecure-base-url', '接口性能测试目标必须使用 HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configError('unsafe-base-url', '接口性能测试目标不得包含凭据、查询参数或片段');
  }
  const hostname = url.hostname.toLowerCase();
  if (!target.allowedHosts.includes(hostname)) {
    throw configError('host-not-allowed', `测试目标主机 ${hostname} 不在精确白名单中`);
  }
  if (environment[target.confirmationEnv] !== hostname) {
    throw configError(
      'host-not-confirmed',
      `必须将 ${target.confirmationEnv} 精确设置为 ${hostname} 后才能运行测试`,
    );
  }
  return Object.freeze({ baseURL: url.toString(), hostname });
}

export async function loadApiPerformanceConfiguration(
  root,
  configFile,
  environment = process.env,
) {
  const configPath = repositoryConfigPath(root, configFile);
  const value = readConfigurationFile(configPath);
  assertObject(value, '性能测试配置');
  assertKnownProperties(value, CONFIG_PROPERTIES, '性能测试配置');
  if (value.$schema != null) nonEmptyString(value.$schema, '性能测试配置.$schema');
  const target = validateTarget(value.target);
  const resolvedTarget = resolveApiPerformanceTarget(target, environment);
  const thresholds = validateThresholds(value.thresholds, 'thresholds');
  const safety = validateSafety(value.safety);
  const execution = validateExecution(value.execution);
  const client = validateClient(root, value.client);
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0 || value.scenarios.length > 100) {
    throw configError('invalid-scenarios', 'scenarios 必须包含 1 到 100 个场景模块路径');
  }
  const scenarioPaths = value.scenarios.map((scenario, index) => (
    repositoryModulePath(root, scenario, `scenarios[${index}]`)
  ));
  if (new Set(scenarioPaths.map(({ relative }) => relative)).size !== scenarioPaths.length) {
    throw configError('duplicate-scenarios', 'scenarios 不得包含重复路径');
  }
  const scenarioModules = await Promise.all(scenarioPaths.map((scenarioPath) => (
    importProjectModule(scenarioPath, '性能测试场景模块')
  )));
  const clientModule = await importProjectModule(client.module, '性能测试客户端模块');
  const createClient = clientModule[client.exportName];
  if (typeof createClient !== 'function') {
    throw configError(
      'missing-client-factory',
      `${client.module.relative} 未导出函数 ${client.exportName}`,
      { details: { location: { path: client.module.relative } } },
    );
  }
  return Object.freeze({
    target,
    resolvedTarget,
    client: Object.freeze({ ...client, createClient }),
    execution,
    thresholds,
    safety,
    scenarios: Object.freeze(scenarioModules.map((module, index) => (
      validateScenarioModule(module, scenarioPaths[index], thresholds, safety)
    ))),
  });
}
