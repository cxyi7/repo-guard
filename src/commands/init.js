import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  CONFIG_FILE,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
  loadConfig,
} from '../config.js';
import { detectProjectArchitectureSetup } from '../gates/quality/architecture-setup.js';
import {
  detectProjectAccessibilityTestSetup,
} from '../gates/testing/accessibility-test-setup.js';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  ARCHITECTURE_POLICY_FILE,
  ensureArchitecturePolicy,
  ensureAccessibilityTestPolicy,
  ensureExceptionPolicy,
  EXCEPTION_POLICY_FILE,
  ensureUnitTestPolicy,
  UNIT_TEST_POLICY_FILE,
} from '../policies/managed-policies.js';
import { ensureProjectConfig } from '../orchestration/setup/config-management.js';
import { detectProjectBuildSetup } from '../gates/quality/build-setup.js';
import { findRepositoryRoot } from '../git.js';
import { installHooks } from '../orchestration/setup/hook-installer.js';
import { detectProjectStylelintSetup } from '../gates/quality/stylelint-setup.js';
import { detectProjectTypeCheckSetup } from '../gates/quality/typecheck-setup.js';
import { detectProjectUnitTestSetup } from '../gates/testing/unit-test-setup.js';
import { writeConsoleMessage } from '../core/report/console-renderer.js';

export function runInit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const architectureSetup = detectProjectArchitectureSetup(
    root,
    DEFAULT_ARCHITECTURE_CONFIG,
  );
  const accessibilityTestSetup = detectProjectAccessibilityTestSetup(
    root,
    DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  );
  const buildSetup = detectProjectBuildSetup(root, DEFAULT_BUILD_CONFIG);
  const stylelintSetup = detectProjectStylelintSetup(root);
  const typeCheckSetup = detectProjectTypeCheckSetup(root, DEFAULT_TYPE_CHECK_CONFIG);
  const unitTestSetup = detectProjectUnitTestSetup(root, DEFAULT_UNIT_TEST_CONFIG);
  const { created: configCreated } = ensureProjectConfig(root, {
    accessibilityTestEnabled: accessibilityTestSetup.ready,
    architectureEnabled: architectureSetup.ready,
    buildEnabled: buildSetup.ready,
    stylelintEnabled: stylelintSetup.ready,
    typeCheckEnabled: typeCheckSetup.ready,
    unitTestEnabled: unitTestSetup.ready,
  });
  const result = installHooks({
    cwd: root,
    updatePackageScripts: true,
  });
  const config = loadConfig(root);
  const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
  const architecturePolicy = config.architecture.enabled
    ? ensureArchitecturePolicy(root, config.architecture)
    : null;
  const accessibilityTestPolicy = config.accessibilityTest.enabled
    ? ensureAccessibilityTestPolicy(root, config.accessibilityTest)
    : null;
  const unitTestPolicy = config.unitTest.enabled
    ? ensureUnitTestPolicy(root, config.unitTest)
    : null;

  writeConsoleMessage(`repo-guard initialized in ${root}`);
  writeConsoleMessage(`- hooks path: ${result.hooksPath}`);
  writeConsoleMessage(`- hooks: ${result.hooks.join(', ')}`);
  writeConsoleMessage(`- .gitattributes: ${result.gitAttributes.changed ? 'updated' : 'preserved'}`);
  writeConsoleMessage(
    `- .gitignore: ${result.localEnvironment.gitIgnore.changed ? 'updated' : 'preserved'}`,
  );
  writeConsoleMessage(
    `- .env.config: ${result.localEnvironment.envFile.created ? 'created' : 'preserved'}`,
  );
  writeConsoleMessage(`- config: ${CONFIG_FILE}${configCreated ? ' (created)' : ' (preserved)'}`);
  writeConsoleMessage(
    `- ${EXCEPTION_POLICY_FILE}: ${exceptionPolicy.changed ? 'updated' : 'preserved'} `
    + '(structured exception policy)',
  );
  if (architecturePolicy) {
    writeConsoleMessage(
      `- ${ARCHITECTURE_POLICY_FILE}: ${architecturePolicy.changed ? 'updated' : 'preserved'}`,
    );
  }
  if (accessibilityTestPolicy) {
    writeConsoleMessage(
      `- ${ACCESSIBILITY_TEST_POLICY_FILE}: `
      + `${accessibilityTestPolicy.changed ? 'updated' : 'preserved'} `
      + '(axe accessibility test policy)',
    );
  }
  if (unitTestPolicy) {
    writeConsoleMessage(
      `- ${UNIT_TEST_POLICY_FILE}: ${unitTestPolicy.changed ? 'updated' : 'preserved'}`,
    );
  }
  if (configCreated && stylelintSetup.ready) {
    writeConsoleMessage(
      `- Stylelint ${stylelintSetup.metadata.version}: enabled with ${stylelintSetup.configFile}`,
    );
  } else if (configCreated) {
    writeConsoleMessage('- Stylelint: disabled until the project installs Stylelint and adds a config');
  }
  if (configCreated) {
    writeConsoleMessage(
      architectureSetup.ready
        ? `- Architecture: enabled with dependency-cruiser ${architectureSetup.setup.dependencyCruiser.version}`
        : '- Architecture: disabled until the project installs dependency-cruiser and provides src',
    );
    writeConsoleMessage(
      buildSetup.ready
        ? `- Build: enabled with npm script "${DEFAULT_BUILD_CONFIG.script}"`
        : '- Build: disabled until the project adds a build script',
    );
    writeConsoleMessage('- Lighthouse: disabled until the Vue project adds @lhci/cli and lighthouserc');
    writeConsoleMessage(
      typeCheckSetup.ready
        ? `- TypeScript: enabled with npm script "${DEFAULT_TYPE_CHECK_CONFIG.script}"`
        : '- TypeScript: disabled until the project adds a typecheck script',
    );
    writeConsoleMessage(
      unitTestSetup.ready
        ? `- Unit tests: enabled with npm script "${DEFAULT_UNIT_TEST_CONFIG.script}"`
        : '- Unit tests: disabled until the project installs Vitest and adds test:unit',
    );
    writeConsoleMessage(
      accessibilityTestSetup.ready
        ? `- Accessibility tests: enabled with npm script "${DEFAULT_ACCESSIBILITY_TEST_CONFIG.script}"`
        : '- Accessibility tests: disabled until the project adds a complete axe test:a11y setup',
    );
  }
  writeConsoleMessage('- run "repo-guard doctor" after configuring notification environment variables');
  return 0;
}

export function runInstallHooks(cwd = process.cwd()) {
  const result = installHooks({
    cwd,
    updatePackageScripts: false,
    allowMissingGit: true,
  });
  if (!result.skipped) {
    writeConsoleMessage(`repo-guard hooks installed in ${result.root}`);
  }
  return 0;
}
