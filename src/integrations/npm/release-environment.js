const RELEASE_ENVIRONMENT_ALLOWLIST = new Set([
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'NO_COLOR',
  'OS',
  'PATH',
  'PATHEXT',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'WINDIR',
]);
const FORBIDDEN_RELEASE_OPERATION = /\b(?:publish|deploy)\b/i;

export function assertReleaseScriptReadOnly(scripts, script) {
  const pending = [`pre${script}`, script, `post${script}`];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current) || typeof scripts[current] !== 'string') continue;
    visited.add(current);
    const command = scripts[current];
    if (FORBIDDEN_RELEASE_OPERATION.test(command)) {
      throw securityError(
        'release-readiness/forbidden-operation',
        `发布就绪脚本 ${current} 不得执行发布或部署`,
        {
          details: { location: { path: 'package.json' } },
          expected: 'release-ready 仅执行只读检查，不发布、不部署且不改变外部状态。',
          decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
        },
      );
    }
    for (const match of command.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      pending.push(`pre${match[1]}`, match[1], `post${match[1]}`);
    }
  }
}

export function releaseEnvironment(env = process.env, cacheDirectory = null) {
  const filtered = Object.fromEntries(
    Object.entries(env).filter(([name]) => RELEASE_ENVIRONMENT_ALLOWLIST.has(name.toUpperCase())),
  );
  if (cacheDirectory) filtered.npm_config_cache = cacheDirectory;
  filtered.npm_config_userconfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return filtered;
}
import { securityError } from '../../core/error/repo-guard-error.js';
