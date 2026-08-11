import {
  CONFIG_FILE,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
  loadConfig,
} from '../config.js';
import { ensureProjectConfig } from '../config-management.js';
import { findRepositoryRoot } from '../git.js';
import { installHooks } from '../hook-installer.js';
import { detectProjectStylelintSetup } from '../stylelint-project.js';
import { detectProjectTypeCheckSetup } from '../typecheck-runner.js';
import {
  ensureUnitTestPolicy,
  UNIT_TEST_POLICY_FILE,
} from '../unit-test-policy.js';
import { detectProjectUnitTestSetup } from '../unit-test-runner.js';

export function runInit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const stylelintSetup = detectProjectStylelintSetup(root);
  const typeCheckSetup = detectProjectTypeCheckSetup(root, DEFAULT_TYPE_CHECK_CONFIG);
  const unitTestSetup = detectProjectUnitTestSetup(root, DEFAULT_UNIT_TEST_CONFIG);
  const { created: configCreated } = ensureProjectConfig(root, {
    stylelintEnabled: stylelintSetup.ready,
    typeCheckEnabled: typeCheckSetup.ready,
    unitTestEnabled: unitTestSetup.ready,
  });
  const result = installHooks({
    cwd: root,
    updatePackageScripts: true,
  });
  const config = loadConfig(root);
  const unitTestPolicy = config.unitTest.enabled
    ? ensureUnitTestPolicy(root, config.unitTest)
    : null;

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
  if (unitTestPolicy) {
    console.log(
      `- ${UNIT_TEST_POLICY_FILE}: ${unitTestPolicy.changed ? 'updated' : 'preserved'}`,
    );
  }
  if (configCreated && stylelintSetup.ready) {
    console.log(
      `- Stylelint ${stylelintSetup.metadata.version}: enabled with ${stylelintSetup.configFile}`,
    );
  } else if (configCreated) {
    console.log('- Stylelint: disabled until the project installs Stylelint and adds a config');
  }
  if (configCreated) {
    console.log('- Lighthouse: disabled until the Vue project adds @lhci/cli and lighthouserc');
    console.log(
      typeCheckSetup.ready
        ? `- TypeScript: enabled with npm script "${DEFAULT_TYPE_CHECK_CONFIG.script}"`
        : '- TypeScript: disabled until the project adds a typecheck script',
    );
    console.log(
      unitTestSetup.ready
        ? `- Unit tests: enabled with npm script "${DEFAULT_UNIT_TEST_CONFIG.script}"`
        : '- Unit tests: disabled until the project installs Vitest and adds test:unit',
    );
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
