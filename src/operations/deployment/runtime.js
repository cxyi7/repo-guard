import { executionError, configurationError } from '../../core/error/repo-guard-error.js';

export function runtimeEnvironment(config) {
  return Object.entries(config.env).map(([key, variable]) => {
    const value = process.env[variable];
    if (value === undefined || /[\r\n\0]/.test(value)) {
      throw configurationError('operations/environment-missing', `部署环境变量缺失或含非法换行：${variable}`);
    }
    return [key, value];
  });
}

export function startCandidate(adapter, release, environment) {
  const { config, docker, labels } = adapter;
  adapter.remove(release.container);
  docker(['run', '-d', '--name', release.container, ...labels,
    '--label', `com.repo-guard.revision=${release.revision}`, '--network', config.network,
    '--restart', 'unless-stopped',
    ...environment.flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    '-e', `REPO_GUARD_REVISION=${release.revision}`,
    ...(config.uploads ? ['--mount', `type=bind,source=${config.uploads.source},target=${config.uploads.target}`] : []),
    release.image]);
}

export function verifyRelease(adapter, release) {
  if (!release) return;
  const record = adapter.inspect('container', release.container);
  if (!record || record.Image !== release.image || record.Config.Labels['com.repo-guard.revision'] !== release.revision) {
    throw executionError('operations/runtime-mismatch', '已登记的应用容器、镜像或代码版本不一致，拒绝切换。');
  }
}

function nginxConfig(adapter, release, maintenance) {
  const destination = release ? `http://${release.container}:${adapter.config.containerPort}` : null;
  const proxy = destination ? `proxy_pass ${destination}; proxy_set_header Host $host; proxy_hide_header X-Repo-Guard-Revision;` : 'return 503;';
  return `server { listen 80; add_header X-Repo-Guard-Revision "${release?.revision ?? 'maintenance'}" always; location = /api/health { ${proxy} } location / { ${maintenance ? 'return 503;' : proxy} } }\n`;
}

export function switchProxy(adapter, release, { maintenance = false } = {}) {
  const { config, docker, helper, labels } = adapter;
  helper('mkdir -p /state/proxy /state/check-proxy');
  const content = nginxConfig(adapter, release, maintenance);
  adapter.write('check-proxy/default.conf', content);
  const mount = `type=volume,source=${adapter.name}-state,target=/state,readonly`;
  // 先验证候选配置，避免把无法加载的文件放到实际入口。
  docker(['run', '--rm', ...labels, '--network', config.network, '--mount', mount,
    config.proxyImage, 'nginx', '-t', '-c', '/state/check-proxy/nginx.conf']);
  adapter.write('proxy/default.conf', content);
  const proxyName = `${adapter.name}-proxy`;
  if (!adapter.inspect('container', proxyName)) {
    docker(['run', '-d', '--name', proxyName, ...labels, '--network', config.network,
      '--restart', 'unless-stopped', '-p', `${config.port}:80`, '--mount', mount,
      config.proxyImage, 'nginx', '-c', '/state/proxy/nginx.conf', '-g', 'daemon off;']);
  } else {
    docker(['start', proxyName]);
    docker(['exec', proxyName, 'nginx', '-t', '-c', '/state/proxy/nginx.conf']);
    docker(['exec', proxyName, 'nginx', '-s', 'reload', '-c', '/state/proxy/nginx.conf']);
  }
}

export function prepareProxy(adapter) {
  adapter.helper('mkdir -p /state/proxy /state/check-proxy');
  for (const directory of ['proxy', 'check-proxy']) {
    adapter.write(`${directory}/nginx.conf`, `events {}\nhttp { include /etc/nginx/mime.types; include /state/${directory}/default.conf; }\n`);
  }
}

export async function waitHealthy(adapter, release, { publicEntry = false, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const url = publicEntry ? adapter.config.healthUrl
    : `http://${release.container}:${adapter.config.containerPort}/api/health`;
  const deadline = Date.now() + adapter.config.timeoutSeconds * 1000;
  do {
    try {
      const probe = adapter.docker(['run', '--rm', '--network', adapter.config.network,
        adapter.config.helperImage, 'node', '-e',
        "const fs=require('node:fs');fetch(process.argv[1], {redirect:'manual',signal:AbortSignal.timeout(5000)}).then(r=>fs.writeSync(1,JSON.stringify({status:r.status,revision:r.headers.get('x-repo-guard-revision')}))).catch(()=>fs.writeSync(1,'{}'))", url], { timeout: 10000 });
      const result = JSON.parse(probe);
      if (result.status === 200 && (!publicEntry || result.revision === release.revision)) return;
    } catch { /* 就绪阶段允许重试；超时统一作为执行错误。 */ }
    await sleep(1000);
  } while (Date.now() < deadline);
  throw executionError('operations/health-failed', publicEntry ? '正式入口 /api/health 未返回 200，发布失败。' : '候选环境 /api/health 未返回 200，发布失败。');
}
