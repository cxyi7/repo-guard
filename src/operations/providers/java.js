import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

export function validateJavaRelease(repositoryRoot, project, unit) {
  const root = path.resolve(repositoryRoot, project.root);
  const relative = path.relative(realpathSync(repositoryRoot), realpathSync(root));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(path.join(root, 'pom.xml'))
    || !unit.build || Object.values(unit.environments).some((environment) => !environment.blueGreen)) {
    throw configurationError('operations/java-build-required',
      'Java 运维适配要求仓库内的 Maven 工程、原生构建命令与蓝绿部署配置；其他 Java 部署方式尚未提供。');
  }
}

export function nativeBuildCommand(build) {
  return [build.command, ...build.args].map((part) => `'${part.replaceAll("'", "'\"'\"'")}'`).join(' ');
}
