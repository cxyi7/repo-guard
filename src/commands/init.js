import { CONFIG_FILE } from '../config.js';
import { ensureProjectConfig } from '../config-management.js';
import { findRepositoryRoot } from '../git.js';
import { installHooks } from '../hook-installer.js';
import { detectProjectStylelintSetup } from '../stylelint-project.js';

export function runInit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const stylelintSetup = detectProjectStylelintSetup(root);
  const { created: configCreated } = ensureProjectConfig(root, {
    stylelintEnabled: stylelintSetup.ready,
  });
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
  if (configCreated && stylelintSetup.ready) {
    console.log(
      `- Stylelint ${stylelintSetup.metadata.version}: enabled with ${stylelintSetup.configFile}`,
    );
  } else if (configCreated) {
    console.log('- Stylelint: disabled until the project installs Stylelint and adds a config');
  }
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
