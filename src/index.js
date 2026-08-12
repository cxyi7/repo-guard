export { loadConfig, matchRule, validateConfig } from './config.js';
export {
  buildAccessibilityTestAiInstructions,
  detectProjectAccessibilityTestSetup,
  inspectAccessibilityTestSetup,
  runAccessibilityTestGate,
  validateAccessibilityTestSetup,
} from './accessibility-test-runner.js';
export {
  ensureAccessibilityTestPolicy,
  isAccessibilityTestPolicyCurrent,
} from './accessibility-test-policy.js';
export {
  assertExceptionRegistryCurrent,
  findStructuredException,
  formatExceptionRegistryReport,
  inspectExceptionRegistry,
} from './exception-registry.js';
export {
  ensureExceptionPolicy,
  isExceptionPolicyCurrent,
} from './exception-policy.js';
export {
  buildDependencyPolicyAiInstructions,
  inspectDependencyPolicy,
  runDependencyPolicy,
  runStagedDependencyPolicy,
} from './dependency-policy.js';
export {
  buildDynamicCodeAiInstructions,
  findDynamicCodeExecution,
  inspectDynamicCode,
  NO_EVAL_RULE,
  NO_FUNCTION_CONSTRUCTOR_RULE,
  runDynamicCodeFiles,
  runDynamicCodeProject,
} from './dynamic-code.js';
export {
  buildArchitectureAiRepairInstructions,
  createDependencyCruiserConfig,
  detectProjectArchitectureSetup,
  formatArchitectureReport,
  parseArchitectureReport,
  runArchitectureGate,
  validateArchitectureSetup,
} from './architecture-runner.js';
export {
  ensureArchitecturePolicy,
  isArchitecturePolicyCurrent,
} from './architecture-policy.js';
export {
  runBuildGate,
  validateBuildSetup,
} from './build-runner.js';
export {
  configureCi,
  createStarterConfig,
  enableQualityGates,
  ensureProjectConfig,
  migrateProjectConfig,
  setFeaturesEnabled,
} from './config-management.js';
export {
  collectRevisionChanges,
  collectStagedChanges,
  collectWorkingTreeChanges,
} from './git-changes.js';
export { resolveCiRange } from './ci-changes.js';
export { runCiGate } from './ci-runner.js';
export {
  GITLAB_CI_FILE,
  GITLAB_TEMPLATE_FILE,
  inspectGitLabCi,
  installGitLabCi,
} from './gitlab-ci.js';
export { ensureGitAttributes } from './git-attributes.js';
export { installHooks } from './hook-installer.js';
export { runEslintFiles } from './eslint-runner.js';
export { buildEslintAiRepairInstructions } from './eslint-diagnostics.js';
export {
  runStyleComplexityProject,
  runStyleGovernanceProject,
  runStylelintFiles,
  STYLE_COMPLEXITY_RULES,
  STYLE_GOVERNANCE_RULES,
} from './stylelint-runner.js';
export { inspectUnexpectedGlobalStyles } from './style-governance.js';
export { buildStylelintAiRepairInstructions } from './stylelint-diagnostics.js';
export { runPrettierFiles } from './prettier-runner.js';
export {
  findVueTemplateElements,
  findVueTemplateAttributes,
  sourceLocation as resolveVueSourceLocation,
} from './vue-template-parser.js';
export {
  buildVueFormLabelAiInstructions,
  findVueFormLabelIssues,
  inspectVueFormLabels,
  runVueFormLabelFiles,
  runVueFormLabelProject,
  VUE_FORM_CONTROL_LABEL_RULE,
} from './vue-form-label.js';
export {
  buildVueImageAltAiInstructions,
  findVueImageAltIssues,
  inspectVueImageAlts,
  runVueImageAltFiles,
  runVueImageAltProject,
  VUE_IMAGE_ALT_RULE,
} from './vue-image-alt.js';
export {
  buildVueTargetBlankAiInstructions,
  findVueTargetBlankIssues,
  inspectVueTargetBlank,
  runVueTargetBlankFiles,
  runVueTargetBlankProject,
  VUE_TARGET_BLANK_RULE,
} from './vue-target-blank.js';
export {
  buildUnsafeVueHtmlAiInstructions,
  findVueVHtml,
  inspectUnsafeVueHtml,
  runUnsafeVueHtmlFiles,
  runUnsafeVueHtmlProject,
  VUE_NO_V_HTML_RULE,
} from './vue-unsafe-html.js';
export {
  buildFilePlacementAiInstructions,
  collectProjectFiles,
  inspectFilePlacement,
  runFilePlacementFiles,
  runFilePlacementProject,
} from './file-placement.js';
export { runQualityGate } from './quality-gate.js';
export { runQualityFiles } from './quality-runner.js';
export {
  analyzeVueSections,
  buildMaxFileLinesAiInstructions,
  buildMaxFileLinesWarnings,
  countPhysicalLines,
  evaluateMaxFileLines,
  inspectMaxFileLines,
  matchMaxFileLineRule,
  runMaxFileLinesFiles,
} from './max-file-lines.js';
export { runVueLighthouse } from './lighthouse-runner.js';
export {
  runTypeCheckGate,
  validateTypeCheckSetup,
} from './typecheck-runner.js';
export {
  buildCoverageArguments,
  formatCoverageReport,
  inspectCoverageReports,
  isCoverageEnabled,
  isStructuredCoverage,
  parseChangedLineNumbers,
  parseCoverageSummary,
  parseLcov,
} from './coverage-runner.js';
export {
  buildUnitTestAiInstructions,
  expectedUnitTestPath,
  expectedUnitTestPaths,
  inspectUnitTestPolicy,
  runUnitTestGate,
  validateUnitTestSetup,
} from './unit-test-runner.js';
export {
  analyzeVueComponentInteractionTest,
  findVueInteractionEntries,
} from './vue-component-interaction.js';
export {
  ensureLocalEnvironment,
  loadLocalEnvironment,
  resolveNotificationEnvironment,
} from './local-env.js';
