import { existsSync, readFileSync } from 'node:fs';
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
  let dependencyPackagePath;
  let entryPath = null;

  try {
    dependencyPackagePath = requireFromProject.resolve(`${packageName}/package.json`);
  } catch {
    const directPackagePath = path.join(root, 'node_modules', packageName, 'package.json');
    if (existsSync(directPackagePath)) {
      dependencyPackagePath = directPackagePath;
    }
  }

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

  if (requireEntry) {
    try {
      entryPath = requireFromProject.resolve(packageName);
    } catch (error) {
      throw configurationError(
        'project-package/dependency-entry-unresolvable',
        `已找到 ${displayName} 的包清单，但无法解析 ${packageName} 的运行入口`,
        {
          cause: error,
          details: {
            location: { path: 'package.json' },
            evidence: [{
              type: 'dependency-entry-resolution',
              message: `已解析包清单，但无法解析运行时入口： ${packageName}`,
              location: {
                path: path.relative(root, dependencyPackagePath).replaceAll('\\', '/'),
              },
            }],
          },
          expected: `${packageName} 提供可由消费项目解析的运行入口。`,
          remediation: dependencyRemediation(packageName),
        },
      );
    }
  }

  const packageJson = JSON.parse(readFileSync(dependencyPackagePath, 'utf8'));
  return {
    entryPath,
    packagePath: dependencyPackagePath,
    version: packageJson.version || 'unknown',
  };
}
