import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

export const LIGHTHOUSE_CONFIG_FILES = Object.freeze([
  '.lighthouserc.js',
  'lighthouserc.js',
  '.lighthouserc.cjs',
  'lighthouserc.cjs',
  '.lighthouserc.json',
  'lighthouserc.json',
  '.lighthouserc.yml',
  'lighthouserc.yml',
  '.lighthouserc.yaml',
  'lighthouserc.yaml',
]);

export function readProjectPackage(root) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) {
    throw configurationError('lighthouse/invalid-setup', `仓库根目录中找不到 package.json：${root}`);
  }
  try {
    return JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw configurationError('lighthouse/invalid-setup', `无法读取 package.json：${error.message}`);
  }
}

export function detectVueProject(root) {
  const packageJson = readProjectPackage(root);
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
  };
  return {
    isVue: Object.hasOwn(dependencies, 'vue'),
    packageJson,
  };
}

export function findProjectLighthouseConfig(root, configuredFile = null) {
  if (configuredFile) {
    if (path.isAbsolute(configuredFile)) {
      throw configurationError('lighthouse/invalid-setup', 'lighthouse.configFile 必须是相对于仓库根目录的路径');
    }
    const resolved = path.resolve(root, configuredFile);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw configurationError('lighthouse/invalid-setup', 'lighthouse.configFile 必须位于仓库根目录内');
    }
    return existsSync(resolved) ? relative.replace(/\\/g, '/') : null;
  }

  return LIGHTHOUSE_CONFIG_FILES.find((file) => existsSync(path.join(root, file))) || null;
}

export function resolveProjectLighthouseMetadata(root) {
  const requireFromProject = createRequire(path.join(root, 'package.json'));
  let packagePath;
  try {
    packagePath = requireFromProject.resolve('@lhci/cli/package.json');
  } catch {
    throw configurationError('lighthouse/invalid-setup',
      'Lighthouse CI 已启用，但当前项目未安装该工具。'
      + '请将 @lhci/cli 安装为项目的 devDependency。',
    );
  }
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const binEntry = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.lhci;
  if (typeof binEntry !== 'string') {
    throw configurationError('lighthouse/invalid-setup',
      `不支持 Lighthouse CI ${packageJson.version || '未知版本'}：缺少 lhci 可执行文件`,
    );
  }
  const binPath = path.resolve(path.dirname(packagePath), binEntry);
  if (!existsSync(binPath)) {
    throw configurationError('lighthouse/invalid-setup', `不支持 Lighthouse CI ${packageJson.version}：找不到 ${binEntry}`);
  }
  return {
    binPath,
    packagePath,
    version: packageJson.version || 'unknown',
  };
}

export function validateVueLighthouseSetup(root, config) {
  const { isVue, packageJson } = detectVueProject(root);
  if (!isVue) {
    throw configurationError('lighthouse/invalid-setup', 'Lighthouse 当前仅支持在 package.json 中声明 vue 的 Vue 项目');
  }

  const lighthouse = resolveProjectLighthouseMetadata(root);
  const configFile = findProjectLighthouseConfig(root, config.configFile);
  if (!configFile) {
    const expected = config.configFile || 'lighthouserc.*';
    throw configurationError('lighthouse/invalid-setup', `找不到 Lighthouse 配置：${expected}`);
  }
  if (config.buildScript && !packageJson.scripts?.[config.buildScript]) {
    throw configurationError('lighthouse/invalid-setup', `找不到 Lighthouse 构建脚本：package.json#scripts.${config.buildScript}`);
  }

  return {
    configFile,
    lighthouse,
    packageJson,
  };
}
