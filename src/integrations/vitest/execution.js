import { spawnSync } from 'node:child_process';
import { buildCoverageArguments } from './coverage.js';

export function executeUnitTests({ root, config }) {
  const scriptArgs = ['run', config.script];
  const coverageArgs = buildCoverageArguments(config);
  if (coverageArgs.length > 0) {
    scriptArgs.push('--', ...coverageArgs);
  }
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${scriptArgs.map((argument) => (
      /[\s&|<>^()]/.test(argument) ? `"${argument.replaceAll('"', '""')}"` : argument
    )).join(' ')}`]
    : scriptArgs;
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}
