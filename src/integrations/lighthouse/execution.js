import { spawnSync } from 'node:child_process';

function runProcess(command, args, { root, timeoutMs }) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });

  return result;
}

export function runLighthouseBuild(root, script, timeoutMs) {
  if (process.platform === 'win32') {
    return runProcess(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `npm run ${script}`],
      { root, timeoutMs },
    );
  }
  return runProcess('npm', ['run', script], { root, timeoutMs });
}

export function runLighthousePhase(root, metadata, configFile, phase, timeoutMs) {
  return runProcess(
    process.execPath,
    [metadata.binPath, phase, `--config=${configFile}`],
    { root, timeoutMs },
  );
}
