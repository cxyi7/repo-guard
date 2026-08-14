import { spawnSync } from 'node:child_process';

export function executeAccessibilityTests({ root, config }) {
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${config.script}`]
    : ['run', config.script];
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}
