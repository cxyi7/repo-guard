import { configurationError } from '../core/error/repo-guard-error.js';
import { runGit } from './execution.js';

export function readStagedMetadataFile(root, filePath) {
  const entry = runGit(['--literal-pathspecs', 'ls-files', '--stage', '--', filePath], { cwd: root }).stdout;
  if (!entry) return null;
  if (!/^100(?:644|755) [a-f0-9]+ 0\t/.test(entry)) throw configurationError('dependency-policy/index-entry', '依赖元数据必须是无冲突的普通暂存文件：' + filePath);
  const result = runGit(['show', `:./${filePath}`], {
    cwd: root,
  });
  return result.stdout;
}

export function readStagedPackageMetadata(root) {
  const packageJson = readStagedMetadataFile(root, 'package.json');
  return {
    packageJson,
    lockfile: packageJson == null
      ? null
      : readStagedMetadataFile(root, 'package-lock.json'),
  };
}
