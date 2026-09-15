import { executionError } from '../../core/error/repo-guard-error.js';

function uploadMount(config) {
  return `type=bind,source=${config.uploads.source},target=/data`;
}

function assertUploads(adapter) {
  if (adapter.config.uploads) {
    const owner = adapter.helper('test ! -L /data/.repo-guard-owner; cat /data/.repo-guard-owner', {
      mounts: [uploadMount(adapter.config)],
    });
    if (owner !== adapter.name) throw executionError('operations/uploads-owner', '上传目录未登记本项目归属，拒绝备份或恢复。');
  }
}

export function verifyDataResources(adapter) {
  const { mysql, redis } = adapter.config;
  assertUploads(adapter);
  for (const value of [mysql, redis].filter(Boolean)) {
    if (!adapter.inspect('container', value.container)) {
      throw executionError('operations/data-missing', `数据容器不存在：${value.container}`);
    }
  }
  if (redis) {
    if (!adapter.inspect('volume', redis.volume)) throw executionError('operations/redis-volume', 'Redis 专用数据卷不存在。');
    const container = adapter.inspect('container', redis.container);
    if (!container.Mounts.some((mount) => mount.Name === redis.volume && mount.Destination === '/data')) {
      throw executionError('operations/redis-volume', 'Redis 数据必须挂载在已声明的专用卷 /data。');
    }
  }
}

export function backupData(adapter, id) {
  const { config, helper, docker, write } = adapter;
  verifyDataResources(adapter);
  helper(`umask 077; mkdir /state/${id}`);
  if (config.mysql) {
    const { container, defaultsFile, database } = config.mysql;
    const sql = docker(['exec', container, 'mysqldump', `--defaults-extra-file=${defaultsFile}`,
      '--single-transaction', '--routines', '--events', '--triggers', '--hex-blob',
      '--set-gtid-purged=OFF', '--no-tablespaces', '--add-drop-database', '--databases', database], { timeout: 600000 });
    if (!sql.includes('CREATE DATABASE') || !sql.includes('Dump completed')) {
      throw executionError('operations/backup-incomplete', 'MySQL 备份缺少完整性标识，拒绝继续发布。');
    }
    write(`${id}/mysql.sql`, sql);
  }
  if (config.uploads) helper(`tar -cpf /state/${id}/uploads.tar -C /data .`, { mounts: [uploadMount(config)] });
  if (config.redis) {
    const saved = docker(['exec', config.redis.container, 'redis-cli', 'SAVE']);
    if (saved !== 'OK') throw executionError('operations/redis-save', 'Redis 快照未成功；需要认证时请在容器内配置 REDISCLI_AUTH。');
    adapter.stop(config.redis.container);
    try {
      helper(`tar -cpf /state/${id}/redis.tar -C /data .`, {
        mounts: [`type=volume,source=${config.redis.volume},target=/data,readonly`],
      });
    } finally { docker(['start', config.redis.container]); }
  }
  write(`${id}/manifest.json`, JSON.stringify({ version: 2, name: adapter.name, mysql: config.mysql,
    uploads: config.uploads, redis: config.redis }));
  helper(`cd /state/${id}; sha256sum manifest.json ${config.mysql ? 'mysql.sql ' : ''}${config.uploads ? 'uploads.tar ' : ''}${config.redis ? 'redis.tar' : ''} > checksums; sha256sum -c checksums`);
}

export function restoreData(adapter, id) {
  if (!/^backup-[a-f0-9-]+$/.test(id)) throw executionError('operations/backup-id', '恢复点标识无效。');
  const { config, helper, docker, read } = adapter;
  verifyDataResources(adapter);
  helper(`cd /state/${id}; sha256sum -c checksums`);
  const expected = JSON.stringify({ version: 2, name: adapter.name, mysql: config.mysql, uploads: config.uploads, redis: config.redis });
  if (read(`${id}/manifest.json`) !== expected) throw executionError('operations/backup-scope', '恢复点的数据范围与当前配置不同，拒绝覆盖。');
  if (config.mysql) docker(['exec', '-i', config.mysql.container, 'mysql',
    `--defaults-extra-file=${config.mysql.defaultsFile}`], { input: read(`${id}/mysql.sql`), timeout: 600000 });
  if (config.uploads) {
    // 目标固定为已验证归属的挂载目录；删除隐藏文件以确保恢复为精确历史状态。
    helper(`find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xpf /state/${id}/uploads.tar -C /data`, { mounts: [uploadMount(config)] });
  }
  if (config.redis) {
    adapter.stop(config.redis.container);
    helper(`find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xpf /state/${id}/redis.tar -C /data`, {
      mounts: [`type=volume,source=${config.redis.volume},target=/data`],
    });
    docker(['start', config.redis.container]);
  }
}
