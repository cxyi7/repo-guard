import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configurationError } from '../error/repo-guard-error.js';

function dependencyRemediation(packageName) {
  return {
    goal: `让消费项目能够从自身依赖中解析 ${packageName}`,
    steps: [
      `将 ${packageName} 安装为消费项目的精确 devDependency`,
      '提交 package.json 与对应锁文件的同步变更',
      '重新运行失败的 repo-guard 门禁',
    ],
    constraints: [
      '必须使用消费项目自己的依赖，不得回退到 repo-guard 内置依赖',
    ],
    verification: [
      `在消费项目根目录确认 Node.js 可以解析 ${packageName}`,
      '确认原门禁返回 passed 或只剩独立的规则违规',
    ],
  };
}

function isWithinDirectory(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function manifestError(root, packageName, displayName, manifestPath, reason, cause) {
  const unreadable = reason === 'unreadable';
  return configurationError(
    `project-package/dependency-manifest-${reason}`,
    unreadable
      ? `无法读取 ${displayName} 的包清单：${packageName}`
      : `${displayName} 的包清单必须是有效的 JSON 对象：${packageName}`,
    {
      cause,
      details: {
        location: { path: path.relative(root, manifestPath).replaceAll('\\', '/') },
      },
      expected: `${packageName} 的 package.json 是可读取的 JSON 对象。`,
      remediation: dependencyRemediation(packageName),
    },
  );
}

function findDependencyManifest(root, packageName, displayName, requireFromProject) {
  // Node supplies lookup order; only consumer ancestor node_modules directories are allowed.
  const searchPaths = (requireFromProject.resolve.paths(packageName) ?? []).filter((directory) => (
    path.basename(directory) === 'node_modules'
    && isWithinDirectory(path.dirname(directory), root)
  ));
  for (const directory of searchPaths) {
    const packageRoot = path.join(directory, packageName);
    const manifestPath = path.join(packageRoot, 'package.json');
    try {
      if (!statSync(packageRoot).isDirectory()) continue;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw manifestError(root, packageName, displayName, manifestPath, 'unreadable', error);
    }
    try {
      return realpathSync(manifestPath);
    } catch (error) {
      throw manifestError(root, packageName, displayName, manifestPath, 'unreadable', error);
    }
  }
  return null;
}

function readDependencyManifest(root, packageName, displayName, manifestPath) {
  let manifestStat;
  try {
    manifestStat = statSync(manifestPath);
  } catch (error) {
    throw manifestError(root, packageName, displayName, manifestPath, 'unreadable', error);
  }
  if (!manifestStat.isFile()) {
    throw manifestError(root, packageName, displayName, manifestPath, 'unreadable');
  }
  let source;
  try {
    source = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    throw manifestError(root, packageName, displayName, manifestPath, 'unreadable', error);
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw manifestError(root, packageName, displayName, manifestPath, 'invalid', error);
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw manifestError(root, packageName, displayName, manifestPath, 'invalid');
  }
  return manifest;
}

export function resolveProjectPackageMetadata(
  root,
  packageName,
  displayName,
  { requireEntry = true } = {},
) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw configurationError(
      'project-package/missing-manifest',
      '消费项目根目录缺少 package.json，无法解析项目依赖',
      {
        details: { location: { path: 'package.json' } },
        expected: '消费项目根目录存在可读取的 package.json。',
        remediation: {
          goal: '恢复消费项目的 npm 包清单',
          steps: ['在项目根目录创建或恢复 package.json，并提交该文件'],
          constraints: ['不要从其他项目复制未经核对的依赖清单'],
          verification: ['运行 npm pkg get name，并重新执行原门禁'],
        },
      },
    );
  }

  const requireFromProject = createRequire(packageJsonPath);
  const dependencyPackagePath = findDependencyManifest(
    root,
    packageName,
    displayName,
    requireFromProject,
  );
  let entryPath = null;

  if (!dependencyPackagePath) {
    throw configurationError(
      'project-package/dependency-not-installed',
      `${displayName} 已启用，但消费项目没有安装 ${packageName}`,
      {
        details: {
          location: { path: 'package.json' },
          evidence: [{
            type: 'dependency-resolution',
            message: `请求的包： ${packageName}；集成： ${displayName}`,
            location: { path: 'package.json' },
          }],
        },
        expected: `${packageName} 由消费项目声明并安装为 devDependency。`,
        remediation: dependencyRemediation(packageName),
      },
    );
  }

  const packageJson = readDependencyManifest(root, packageName, displayName, dependencyPackagePath);

  if (requireEntry) {
    let entryResolutionError;
    let physicalEntryPath;
    try {
      entryPath = requireFromProject.resolve(packageName);
      physicalEntryPath = realpathSync(entryPath);
    } catch (error) {
      entryResolutionError = error;
    }
    if (
      entryResolutionError
      || !isWithinDirectory(path.dirname(dependencyPackagePath), physicalEntryPath)
    ) {
      throw configurationError(
        'project-package/dependency-entry-unresolvable',
        `已找到 ${displayName} 的包清单，但无法解析 ${packageName} 的运行入口`,
        {
          cause: entryResolutionError,
          details: {
            location: { path: 'package.json' },
            evidence: [{
              type: 'dependency-entry-resolution',
              message: `已解析最近安装的包清单，但无法定位该安装内的运行入口： ${packageName}`,
              location: {
                path: path.relative(root, dependencyPackagePath).replaceAll('\\', '/'),
              },
            }],
          },
          expected: `${packageName} 在同一安装内提供可由消费项目通过 Node.js require 解析条件定位的运行入口。`,
          remediation: dependencyRemediation(packageName),
        },
      );
    }
  }

  return {
    entryPath,
    packagePath: dependencyPackagePath,
    version: packageJson.version || 'unknown',
  };
}
