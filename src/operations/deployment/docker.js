import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { executionError } from '../../core/error/repo-guard-error.js';
import { processExecutionToStatus } from '../../core/result/exit-code.js';

export const OWNER_LABEL = 'com.repo-guard.deployment';

export function dockerCommand(args, { input, timeout = 180000, cwd } = {}) {
  const result = spawnSync('docker', args, {
    cwd, input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 256 * 1024 * 1024,
  });
  if (processExecutionToStatus(result) !== 'passed') {
    const uncertain = result.signal || result.error?.code === 'ETIMEDOUT';
    throw executionError(uncertain ? 'operations/docker-uncertain' : 'operations/docker-failed',
      uncertain ? 'Docker 操作超时或被信号终止，服务器上的操作可能仍在执行，须确认停止后恢复。' : 'Docker 操作失败。', {
      details: { rawExitCode: result.status, signal: result.signal, operation: args[0] },
    });
  }
  return result.stdout.trim();
}

export function createDockerDeployment(config, { command = dockerCommand } = {}) {
  const name = config.name;
  const volume = `${name}-state`;
  const labels = ['--label', `${OWNER_LABEL}=${name}`];
  const docker = (args, options) => command(args, options);
  const inspect = (kind, id) => {
    const listed = docker(kind === 'container' ? ['container', 'ls', '-a', '--format', '{{.Names}}']
      : [kind, 'ls', '--format', '{{.Name}}']).split('\n');
    if (!listed.includes(id)) return null;
    const record = JSON.parse(docker([kind, 'inspect', id]))[0];
    if ((record.Config?.Labels ?? record.Labels)?.[OWNER_LABEL] !== (kind === 'network' ? config.network : name)) {
      throw executionError('operations/resource-owner', `拒绝操作不属于本部署的资源：${id}`);
    }
    return record;
  };
  const helper = (script, { input, mounts = [], timeout } = {}) => docker([
    'run', '--rm', '-i', ...labels, '--mount', `type=volume,source=${volume},target=/state`,
    ...mounts.flatMap((mount) => ['--mount', mount]), config.helperImage, 'sh', '-eu', '-c', script,
  ], { input, timeout });
  const write = (file, content) => helper(`umask 077; cat > /state/${file}.tmp; mv /state/${file}.tmp /state/${file}`, { input: content });
  const read = (file) => helper(`if test -f /state/${file}; then cat /state/${file}; fi`);
  return {
    config, name, labels, docker, inspect, helper, write, read,
    initialize() {
      if (!inspect('volume', volume)) docker(['volume', 'create', ...labels, volume]);
      if (!inspect('network', config.network)) docker(['network', 'create', '--label', `${OWNER_LABEL}=${config.network}`, config.network]);
    },
    lock() {
      const token = randomUUID();
      // Docker 名称在同一守护进程内唯一，覆盖流水线与手动命令的并发。
      docker(['create', '--name', `${name}-lock`, ...labels, '--label', `com.repo-guard.token=${token}`,
        config.helperImage, 'true']);
      return () => {
        const lock = inspect('container', `${name}-lock`);
        if (lock?.Config.Labels['com.repo-guard.token'] !== token) {
          throw executionError('operations/lock-changed', '部署锁已变化，拒绝移除。');
        }
        docker(['rm', `${name}-lock`]);
      };
    },
    state() {
      if (!inspect('volume', volume)) return { version: 2, name, active: null, previous: null, pending: null };
      const raw = read('state.json');
      if (!raw) return { version: 2, name, active: null, previous: null, pending: null };
      let value;
      try { value = JSON.parse(raw); } catch { throw executionError('operations/state-invalid', '部署记录损坏，拒绝自动修改环境。'); }
      const validRelease = (release) => release === null || (release && ['blue', 'green'].includes(release.color)
        && release.container === `${name}-${release.color}` && /^sha256:[a-f0-9]{64}$/.test(release.image)
        && /^[a-f0-9]{40,64}$/.test(release.revision));
      if (value.version !== 2 || value.name !== name || !Object.hasOwn(value, 'pending')
        || !validRelease(value.active) || !validRelease(value.previous)
        || (value.pending && (!validRelease(value.pending.old) || !validRelease(value.pending.next)
          || !(value.pending.restorePoint === null && value.pending.backupComplete === false)
            && !/^backup-[a-f0-9-]+$/.test(value.pending.restorePoint)))) {
        throw executionError('operations/state-invalid', '部署记录格式或项目标识不符，拒绝自动修改环境。');
      }
      return value;
    },
    save(state) { write('state.json', JSON.stringify(state)); },
    stop(id) { if (inspect('container', id)?.State.Running) docker(['stop', '--time', '30', id]); },
    remove(id) { if (inspect('container', id)) docker(['rm', '-f', id]); },
  };
}
