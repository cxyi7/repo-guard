import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';

const SUPPORTED_MAJOR = 6;

function assertPathHasNoSymbolicLink(root, target, label) {
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw configurationError(
        'dead-code/symbolic-link-rejected',
        `${label} 的路径不得经过符号链接`,
      );
    }
  }
}

function repositoryFile(root, relativePath, label) {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw configurationError('dead-code/path-outside-repository', `${label} 必须位于仓库内部`);
  }
  if (!existsSync(target)) {
    throw configurationError('dead-code/file-missing', `${label} 不存在：${relativePath}`);
  }
  assertPathHasNoSymbolicLink(root, target, label);
  if (!lstatSync(target).isFile()) {
    throw configurationError('dead-code/not-a-file', `${label} 必须是普通文件：${relativePath}`);
  }
  return target;
}

function parseMajor(version) {
  const match = /^(\d+)\./.exec(version);
  return match ? Number(match[1]) : null;
}

export function resolveProjectKnip(root, config) {
  const metadata = resolveProjectPackageMetadata(root, 'knip', '无效代码门禁', {
    requireEntry: false,
  });
  if (parseMajor(metadata.version) !== SUPPORTED_MAJOR) {
    throw configurationError(
      'dead-code/unsupported-knip-version',
      `无效代码门禁只支持 Knip ${SUPPORTED_MAJOR}.x；当前版本为 ${metadata.version}`,
    );
  }
  const packageJson = JSON.parse(readFileSync(metadata.packagePath, 'utf8'));
  const binary = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.knip;
  if (typeof binary !== 'string' || !binary.trim()) {
    throw configurationError('dead-code/missing-knip-binary', '消费项目安装的 Knip 缺少 knip CLI');
  }
  const cliPath = path.resolve(path.dirname(metadata.packagePath), binary);
  if (!existsSync(cliPath) || !lstatSync(cliPath).isFile()) {
    throw configurationError('dead-code/knip-binary-missing', '消费项目 Knip 的 CLI 文件不存在');
  }
  const configFile = config.configFile == null
    ? null
    : repositoryFile(root, config.configFile, 'Knip 配置文件');
  return Object.freeze({
    cliPath,
    configFile,
    version: metadata.version,
  });
}

export function resolveDeadCodeBaselinePath(root, relativePath, { requireExisting = false } = {}) {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw configurationError('dead-code/baseline-outside-repository', '无效代码基线必须位于仓库内部');
  }
  assertPathHasNoSymbolicLink(root, target, '无效代码基线');
  if (requireExisting && !existsSync(target)) {
    throw configurationError(
      'dead-code/baseline-missing',
      `noRegression 模式缺少无效代码基线：${relativePath}`,
    );
  }
  return target;
}
