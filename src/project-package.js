import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export function resolveProjectPackageMetadata(root, packageName, displayName) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json was not found in repository root: ${root}`);
  }

  const requireFromProject = createRequire(packageJsonPath);
  let dependencyPackagePath;
  let entryPath;

  try {
    dependencyPackagePath = requireFromProject.resolve(`${packageName}/package.json`);
    entryPath = requireFromProject.resolve(packageName);
  } catch {
    throw new Error(
      `${displayName} is enabled but is not installed by this project. `
      + `Install ${packageName} as a project devDependency.`,
    );
  }

  const packageJson = JSON.parse(readFileSync(dependencyPackagePath, 'utf8'));
  return {
    entryPath,
    packagePath: dependencyPackagePath,
    version: packageJson.version || 'unknown',
  };
}
