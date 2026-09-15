import { configurationError } from '../../core/error/repo-guard-error.js';

function invalid(location) {
  throw configurationError('operations/blue-green-config', `蓝绿部署配置无效：${location}`);
}

function object(value, keys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) invalid(location);
}

function text(value, expression, location) {
  if (typeof value !== 'string' || !expression.test(value)) invalid(location);
  return value;
}

function integer(value, min, max, location) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(location);
  return value;
}

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,240}$/;
const PATH = /^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;

export function validateBlueGreen(value) {
  object(value, ['name', 'network', 'port', 'containerPort', 'dockerfile', 'healthUrl',
    'timeoutSeconds', 'env', 'backup', 'uploads', 'mysql', 'redis', 'proxyImage', 'helperImage'], 'blueGreen');
  const name = text(value.name, NAME, 'name');
  const backup = value.backup === undefined ? { enabled: false } : value.backup;
  object(backup, ['enabled'], 'backup');
  if (typeof backup.enabled !== 'boolean') invalid('backup.enabled');
  let url;
  try { url = new URL(value.healthUrl); } catch { invalid('healthUrl'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/api/health' || url.search || url.hash) invalid('healthUrl');
  const env = value.env ?? {};
  object(env, Object.keys(env), 'env');
  for (const [key, variable] of Object.entries(env)) {
    text(key, /^[A-Z][A-Z0-9_]*$/, 'env');
    text(variable, /^[A-Z][A-Z0-9_]*$/, `env.${key}`);
  }
  const uploads = value.uploads ?? null;
  if (uploads !== null) {
    object(uploads, ['source', 'target'], 'uploads');
    text(uploads.source, PATH, 'uploads.source');
    text(uploads.target, PATH, 'uploads.target');
    if (['/etc', '/var', '/usr', '/root', '/home', '/srv', '/opt', '/tmp'].includes(uploads.source)) invalid('uploads.source');
  }
  const mysql = value.mysql ?? null;
  if (mysql !== null) {
    object(mysql, ['container', 'database', 'defaultsFile'], 'mysql');
    text(mysql.container, NAME, 'mysql.container');
    text(mysql.database, /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, 'mysql.database');
    text(mysql.defaultsFile, PATH, 'mysql.defaultsFile');
  }
  const redis = value.redis ?? null;
  if (redis !== null) {
    object(redis, ['container', 'volume'], 'redis');
    text(redis.container, NAME, 'redis.container');
    text(redis.volume, NAME, 'redis.volume');
  }
  if (backup.enabled && !mysql && !uploads && !redis) invalid('backup：启用备份时至少声明一种数据资源');
  return {
    name, network: text(value.network, NAME, 'network'),
    port: integer(value.port, 1024, 65535, 'port'),
    containerPort: integer(value.containerPort, 1, 65535, 'containerPort'),
    dockerfile: text(value.dockerfile ?? 'Dockerfile', /^(?!.*\.\.)(?!\/)[a-zA-Z0-9._/-]+$/, 'dockerfile'),
    healthUrl: url.href, timeoutSeconds: integer(value.timeoutSeconds ?? 120, 1, 1800, 'timeoutSeconds'),
    env: { ...env }, backup: { enabled: backup.enabled }, uploads, mysql, redis,
    proxyImage: text(value.proxyImage ?? 'nginx:1.28-alpine', IMAGE, 'proxyImage'),
    helperImage: text(value.helperImage ?? 'node:22.23.2-alpine', IMAGE, 'helperImage'),
  };
}
