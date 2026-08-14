import { runGit } from '../../git.js';

function readStagedFile(root, filePath) {
  const result = runGit(['show', `:${filePath}`], {
    allowFailure: true,
    cwd: root,
  });
  return result.status === 0 ? result.stdout : null;
}

export function readStagedPackageMetadata(root) {
  const packageJson = readStagedFile(root, 'package.json');
  return {
    packageJson,
    lockfile: packageJson == null
      ? null
      : readStagedFile(root, 'package-lock.json'),
  };
}
