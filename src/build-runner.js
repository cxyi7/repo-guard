import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw new Error(`package.json was not found in repository root: ${root}`);
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateBuildSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(`Build gate requires package.json script "${config.script}"`);
  }
  return { command: command.trim() };
}

export function detectProjectBuildSetup(root, config) {
  try {
    return { ready: true, setup: validateBuildSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}

function runNpmScript(root, config) {
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${config.script}`]
    : ['run', config.script];
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}

export function runBuildGate({ root, config }) {
  const setup = validateBuildSetup(root, config);
  console.log(
    `repo-guard build: running npm script "${config.script}" (${setup.command})...`,
  );
  const result = runNpmScript(root, config);
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      console.error(`项目构建超过 ${config.timeoutMs}ms，推送已停止。`);
      return 1;
    }
    throw new Error(`Unable to run project build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error([
      `项目构建失败（退出码 ${result.status ?? 1}），推送已停止。`,
      '请根据上方构建输出修复源码、配置、依赖或资源问题。',
      '不得把构建脚本改为空操作、忽略构建错误、关闭生产优化或修改门禁绕过。',
      `修复后重新运行 npm run ${config.script}。`,
    ].join('\n'));
    return result.status ?? 1;
  }
  console.log('repo-guard build passed.');
  return 0;
}
