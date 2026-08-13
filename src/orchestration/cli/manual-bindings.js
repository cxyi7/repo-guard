import { runAccessibilityTestCommand } from '../../commands/accessibility-test.js';
import { runArchitectureCommand } from '../../commands/architecture.js';
import { runBuildCommand } from '../../commands/build.js';
import { runDependenciesCommand } from '../../commands/dependencies.js';
import { runExceptionsCommand } from '../../commands/exceptions.js';
import { runFilePlacementCommand } from '../../commands/file-placement.js';
import { runFormLabelsCommand } from '../../commands/form-labels.js';
import { runImageAltCommand } from '../../commands/image-alt.js';
import { runLighthouseCommand } from '../../commands/lighthouse.js';
import { runStyleComplexityCommand } from '../../commands/style-complexity.js';
import { runStyleGovernanceCommand } from '../../commands/style-governance.js';
import { runTargetBlankCommand } from '../../commands/target-blank.js';
import { runTypeCheckCommand } from '../../commands/typecheck.js';
import { runUnitTestCommand } from '../../commands/unit-test.js';
import { runUnsafeHtmlCommand } from '../../commands/unsafe-html.js';

export const legacyManualBindings = Object.freeze({
  'repository.structured-exceptions': ({ cwd }) => runExceptionsCommand(cwd),
  'dependencies.policy': ({ cwd }) => runDependenciesCommand(cwd),
  'security.vue-unsafe-html': ({ cwd }) => runUnsafeHtmlCommand(cwd),
  'security.vue-target-blank': ({ cwd }) => runTargetBlankCommand(cwd),
  'accessibility.vue-form-label': ({ cwd }) => runFormLabelsCommand(cwd),
  'accessibility.vue-image-alt': ({ cwd }) => runImageAltCommand(cwd),
  'repository.file-placement': ({ cwd }) => runFilePlacementCommand(cwd),
  'quality.typecheck': ({ cwd }) => runTypeCheckCommand(cwd),
  'quality.unit-test': ({ cwd }) => runUnitTestCommand(cwd),
  'quality.accessibility-test': ({ cwd }) => runAccessibilityTestCommand(cwd),
  'quality.architecture': ({ cwd }) => runArchitectureCommand(cwd),
  'quality.build': ({ cwd }) => runBuildCommand(cwd),
  'quality.lighthouse': ({ argumentsList, cwd }) => runLighthouseCommand(cwd, {
    skipBuild: argumentsList.includes('--skip-build'),
  }),
  'quality.style-complexity': ({ cwd }) => runStyleComplexityCommand(cwd),
  'quality.style-governance': ({ cwd }) => runStyleGovernanceCommand(cwd),
});
