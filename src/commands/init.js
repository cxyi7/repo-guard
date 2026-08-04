import { CONFIG_FILE } from '../config.js';
import { ensureProjectConfig } from '../config-management.js';
import { findRepositoryRoot } from '../git.js';
import { installHooks } from '../hook-installer.js';

export function runInit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const { created: configCreated } = ensureProjectConfig(root);
  const result = installHooks({
    cwd: root,
    updatePackageScripts: true,
  });

  console.log(`repo-guard initialized in ${root}`);
  console.log(`- hooks path: ${result.hooksPath}`);
  console.log(`- hooks: ${result.hooks.join(', ')}`);
  console.log(`- .gitattributes: ${result.gitAttributes.changed ? 'updated' : 'preserved'}`);
  console.log(
    `- .gitignore: ${result.localEnvironment.gitIgnore.changed ? 'updated' : 'preserved'}`,
  );
  console.log(
    `- .env.config: ${result.localEnvironment.envFile.created ? 'created' : 'preserved'}`,
  );
  console.log(`- config: ${CONFIG_FILE}${configCreated ? ' (created)' : ' (preserved)'}`);
  console.log('- run "repo-guard doctor" after configuring notification environment variables');
  return 0;
}

export function runInstallHooks(cwd = process.cwd()) {
  const result = installHooks({
    cwd,
    updatePackageScripts: false,
    allowMissingGit: true,
  });
  if (!result.skipped) {
    console.log(`repo-guard hooks installed in ${result.root}`);
  }
  return 0;
}
