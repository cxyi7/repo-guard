import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, 'src');
const CONFIGURATION_VALIDATION_PATH = path.join(
  SOURCE_ROOT,
  'config',
  'configuration-validation.js',
);
const CONFIGURATION_LOADER_PATH = path.join(
  SOURCE_ROOT,
  'config',
  'configuration-loader.js',
);

test('keeps immutable platform defaults in their owning config module', () => {
  const defaultsPath = path.join(SOURCE_ROOT, 'config', 'defaults.js');
  assert.equal(existsSync(defaultsPath), true);

  const defaultsSource = readFileSync(defaultsPath, 'utf8');
  assert.match(defaultsSource, /export const DEFAULT_ARCHITECTURE_CONFIG/);
  assert.match(defaultsSource, /export const DEFAULT_UNIT_TEST_CONFIG/);
  assert.match(defaultsSource, /export const DEFAULT_FILE_PLACEMENT_CONFIG/);
  assert.match(defaultsSource, /Object\.freeze/);
  assert.doesNotMatch(defaultsSource, /^import /m);
});

test('keeps path normalization and rule matching in their owning config module', () => {
  const pathMatchingPath = path.join(SOURCE_ROOT, 'config', 'path-matching.js');
  assert.equal(existsSync(pathMatchingPath), true);

  const pathMatchingSource = readFileSync(pathMatchingPath, 'utf8');
  const publicEntrySource = readFileSync(path.join(SOURCE_ROOT, 'index.js'), 'utf8');
  const classificationSource = readFileSync(
    path.join(SOURCE_ROOT, 'policies', 'change-classification.js'),
    'utf8',
  );

  assert.match(pathMatchingSource, /export function normalizeGitPath/);
  assert.match(pathMatchingSource, /export function globToRegExp/);
  assert.match(pathMatchingSource, /export function matchRule/);
  assert.doesNotMatch(pathMatchingSource, /^import /m);
  assert.match(publicEntrySource, /from ['"]\.\/config\/path-matching\.js['"]/);
  assert.match(classificationSource, /from ['"]\.\.\/config\/path-matching\.js['"]/);
});

test('keeps shared configuration validation primitives in the config module', () => {
  const primitivesPath = path.join(SOURCE_ROOT, 'config', 'validation-primitives.js');
  assert.equal(existsSync(primitivesPath), true);

  const configurationLoaderSource = readFileSync(CONFIGURATION_LOADER_PATH, 'utf8');
  const primitivesSource = readFileSync(primitivesPath, 'utf8');
  const ciRunnerSource = readFileSync(
    path.join(SOURCE_ROOT, 'orchestration', 'ci', 'runner.js'),
    'utf8',
  );

  assert.match(configurationLoaderSource, /from ['"]\.\/validation-primitives\.js['"]/);
  assert.match(
    configurationLoaderSource,
    /import\s*\{\s*CONFIG_FILE\s*\}\s*from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    configurationLoaderSource,
    /import\s*\{[^}]*validateCiReportPath[^}]*\}\s*from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(configurationLoaderSource, /^function configValidationError/m);
  assert.doesNotMatch(configurationLoaderSource, /^export const CONFIG_FILE/m);
  assert.match(primitivesSource, /export const CONFIG_FILE/);
  assert.match(primitivesSource, /export function configValidationError/);
  assert.match(primitivesSource, /export function normalizeRelativePattern/);
  assert.match(primitivesSource, /export function validateCiReportPath/);
  assert.match(primitivesSource, /from ['"]\.\/path-matching\.js['"]/);
  assert.doesNotMatch(primitivesSource, /from ['"][^'"]*(?:policies|orchestration)\//);
  assert.match(ciRunnerSource, /from ['"]\.\.\/\.\.\/config\/validation-primitives\.js['"]/);
});

test('keeps configuration validation and loading in config modules without a root facade', () => {
  assert.equal(existsSync(CONFIGURATION_VALIDATION_PATH), true);
  assert.equal(existsSync(CONFIGURATION_LOADER_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'config.js')), false);

  const publicEntrySource = readFileSync(path.join(SOURCE_ROOT, 'index.js'), 'utf8');
  const configurationLoaderSource = readFileSync(CONFIGURATION_LOADER_PATH, 'utf8');
  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );

  assert.match(
    publicEntrySource,
    /from ['"]\.\/config\/configuration-loader\.js['"]/,
  );
  assert.match(
    publicEntrySource,
    /from ['"]\.\/config\/configuration-validation\.js['"]/,
  );
  assert.match(
    configurationLoaderSource,
    /from ['"]\.\/configuration-validation\.js['"]/,
  );
  assert.match(configurationLoaderSource, /export function loadConfig/);
  assert.match(configurationLoaderSource, /JSON\.parse\(readFileSync/);
  assert.match(configurationLoaderSource, /assertExceptionLifecycleCurrent/);
  assert.match(
    configurationLoaderSource,
    /from ['"]\.\/exception-lifecycle\.js['"]/,
  );
  assert.doesNotMatch(configurationLoaderSource, /from ['"][^'"]*policies\//);
  assert.match(
    configurationValidationSource,
    /export function validateConfigValue/,
  );
  assert.match(configurationValidationSource, /export function validateConfig/);
  assert.match(configurationValidationSource, /validateConfigValue\(value, configPath\)/);
  for (const moduleName of [
    'accessibility',
    'architecture',
    'ci',
    'dependency-policy',
    'exception',
    'execution-gate',
    'notification',
    'pre-commit',
    'protected-file',
    'root-configuration',
    'unit-test',
  ]) {
    assert.match(
      configurationValidationSource,
      new RegExp(`from ['"]\\./${moduleName}-validation\\.js['"]`),
    );
  }
  assert.doesNotMatch(
    configurationValidationSource,
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
  assert.doesNotMatch(configurationValidationSource, /(?:readFileSync|JSON\.parse)/);
});

test('keeps the root configuration contract in its config module', () => {
  const rootValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'root-configuration-validation.js',
  );
  assert.equal(existsSync(rootValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const rootValidationSource = readFileSync(rootValidationPath, 'utf8');

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/root-configuration-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateRootConfigurationContract\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /must contain a JSON object/);
  assert.doesNotMatch(configurationValidationSource, /uses unsupported version/);
  assert.doesNotMatch(configurationValidationSource, /assertKnownProperties\(/);
  assert.match(
    rootValidationSource,
    /export function validateRootConfigurationContract/,
  );
  assert.match(
    rootValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    rootValidationSource,
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
  assert.doesNotMatch(
    rootValidationSource,
    /from ['"]\.\/(?:ci|notification|pre-commit|protected-file)-validation\.js['"]/,
  );
});

test('keeps CI and external gate validation in the config module', () => {
  const ciValidationPath = path.join(SOURCE_ROOT, 'config', 'ci-validation.js');
  assert.equal(existsSync(ciValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const ciValidationSource = readFileSync(ciValidationPath, 'utf8');

  assert.match(configurationValidationSource, /from ['"]\.\/ci-validation\.js['"]/);
  assert.match(
    configurationValidationSource,
    /validateCiConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const externalGatesValue =/);
  assert.match(ciValidationSource, /export function validateCiConfiguration/);
  assert.match(ciValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(ciValidationSource, /from ['"]\.\/validation-primitives\.js['"]/);
  assert.doesNotMatch(ciValidationSource, /from ['"][^'"]*(?:commands|orchestration)\//);
});

test('keeps structured exception validation in the config module', () => {
  const exceptionValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'exception-validation.js',
  );
  assert.equal(existsSync(exceptionValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const exceptionValidationSource = readFileSync(exceptionValidationPath, 'utf8');

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/exception-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateExceptionConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const exceptionsValue =/);
  assert.match(exceptionValidationSource, /export function validateExceptionConfiguration/);
  assert.match(exceptionValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(exceptionValidationSource, /from ['"]\.\/validation-primitives\.js['"]/);
  assert.doesNotMatch(
    exceptionValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps dependency policy configuration validation in the config module', () => {
  const dependencyPolicyValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'dependency-policy-validation.js',
  );
  assert.equal(existsSync(dependencyPolicyValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const dependencyPolicyValidationSource = readFileSync(
    dependencyPolicyValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/dependency-policy-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateDependencyPolicyConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const dependencyPolicyValue =/);
  assert.match(
    dependencyPolicyValidationSource,
    /export function validateDependencyPolicyConfiguration/,
  );
  assert.match(dependencyPolicyValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    dependencyPolicyValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    dependencyPolicyValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps architecture configuration validation in the config module', () => {
  const architectureValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'architecture-validation.js',
  );
  assert.equal(existsSync(architectureValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const architectureValidationSource = readFileSync(
    architectureValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/architecture-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateArchitectureConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const architectureValue =/);
  assert.match(
    architectureValidationSource,
    /export function validateArchitectureConfiguration/,
  );
  assert.match(architectureValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    architectureValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    architectureValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps external execution gate validation in the config module', () => {
  const executionGateValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'execution-gate-validation.js',
  );
  assert.equal(existsSync(executionGateValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const executionGateValidationSource = readFileSync(
    executionGateValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/execution-gate-validation\.js['"]/,
  );
  assert.match(configurationValidationSource, /validateExecutionGateConfiguration\(/);
  assert.doesNotMatch(
    configurationValidationSource,
    /const (?:build|lighthouse|typeCheck)Value =/,
  );
  assert.match(
    executionGateValidationSource,
    /export function validateExecutionGateConfiguration/,
  );
  assert.match(executionGateValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    executionGateValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    executionGateValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps accessibility configuration validation in the config module', () => {
  const accessibilityValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'accessibility-validation.js',
  );
  assert.equal(existsSync(accessibilityValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const accessibilityValidationSource = readFileSync(
    accessibilityValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/accessibility-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateAccessibilityConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const accessibilityTestValue =/);
  assert.match(
    accessibilityValidationSource,
    /export function validateAccessibilityConfiguration/,
  );
  assert.match(accessibilityValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    accessibilityValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    accessibilityValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps unit test configuration validation in the config module', () => {
  const unitTestValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'unit-test-validation.js',
  );
  assert.equal(existsSync(unitTestValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const unitTestValidationSource = readFileSync(unitTestValidationPath, 'utf8');

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/unit-test-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateUnitTestConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const unitTestValue =/);
  assert.match(
    unitTestValidationSource,
    /export function validateUnitTestConfiguration/,
  );
  assert.match(unitTestValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(unitTestValidationSource, /from ['"]\.\/path-matching\.js['"]/);
  assert.match(
    unitTestValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    unitTestValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps file placement configuration validation in the config module', () => {
  const filePlacementValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'file-placement-validation.js',
  );
  assert.equal(existsSync(filePlacementValidationPath), true);

  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const filePlacementValidationSource = readFileSync(
    filePlacementValidationPath,
    'utf8',
  );

  assert.match(
    preCommitValidationSource,
    /from ['"]\.\/file-placement-validation\.js['"]/,
  );
  assert.match(
    preCommitValidationSource,
    /validateFilePlacementConfiguration\(preCommitValue, configPath\)/,
  );
  assert.doesNotMatch(preCommitValidationSource, /const filePlacementValue =/);
  assert.match(
    filePlacementValidationSource,
    /export function validateFilePlacementConfiguration/,
  );
  assert.match(filePlacementValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    filePlacementValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    filePlacementValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps maximum file line configuration validation in the config module', () => {
  const maxFileLinesValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'max-file-lines-validation.js',
  );
  assert.equal(existsSync(maxFileLinesValidationPath), true);

  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const maxFileLinesValidationSource = readFileSync(
    maxFileLinesValidationPath,
    'utf8',
  );

  assert.match(
    preCommitValidationSource,
    /from ['"]\.\/max-file-lines-validation\.js['"]/,
  );
  assert.match(
    preCommitValidationSource,
    /validateMaxFileLinesConfiguration\(preCommitValue, configPath\)/,
  );
  assert.doesNotMatch(preCommitValidationSource, /const maxFileLinesValue =/);
  assert.match(
    maxFileLinesValidationSource,
    /export function validateMaxFileLinesConfiguration/,
  );
  assert.match(maxFileLinesValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(maxFileLinesValidationSource, /from ['"]\.\/path-matching\.js['"]/);
  assert.match(
    maxFileLinesValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    maxFileLinesValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps Stylelint configuration validation in the config module', () => {
  const stylelintValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'stylelint-validation.js',
  );
  assert.equal(existsSync(stylelintValidationPath), true);

  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const stylelintValidationSource = readFileSync(stylelintValidationPath, 'utf8');

  assert.match(
    preCommitValidationSource,
    /from ['"]\.\/stylelint-validation\.js['"]/,
  );
  assert.match(
    preCommitValidationSource,
    /validateStylelintConfiguration\(preCommitValue, configPath\)/,
  );
  assert.doesNotMatch(preCommitValidationSource, /const stylelintValue =/);
  assert.match(
    stylelintValidationSource,
    /export function validateStylelintConfiguration/,
  );
  assert.match(stylelintValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    stylelintValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    stylelintValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps Prettier configuration validation in the config module', () => {
  const prettierValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'prettier-validation.js',
  );
  assert.equal(existsSync(prettierValidationPath), true);

  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const prettierValidationSource = readFileSync(prettierValidationPath, 'utf8');

  assert.match(
    preCommitValidationSource,
    /from ['"]\.\/prettier-validation\.js['"]/,
  );
  assert.match(
    preCommitValidationSource,
    /validatePrettierConfiguration\(preCommitValue, configPath\)/,
  );
  assert.doesNotMatch(preCommitValidationSource, /const prettierValue =/);
  assert.match(
    prettierValidationSource,
    /export function validatePrettierConfiguration/,
  );
  assert.match(prettierValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    prettierValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    prettierValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps ESLint configuration validation in the config module', () => {
  const eslintValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'eslint-validation.js',
  );
  assert.equal(existsSync(eslintValidationPath), true);

  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const eslintValidationSource = readFileSync(eslintValidationPath, 'utf8');

  assert.match(
    preCommitValidationSource,
    /from ['"]\.\/eslint-validation\.js['"]/,
  );
  assert.match(
    preCommitValidationSource,
    /validateEslintConfiguration\(preCommitValue, configPath\)/,
  );
  assert.doesNotMatch(preCommitValidationSource, /const eslintValue =/);
  assert.match(
    eslintValidationSource,
    /export function validateEslintConfiguration/,
  );
  assert.match(eslintValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    eslintValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    eslintValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps staged quality configuration validation in its config module', () => {
  const preCommitValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'pre-commit-validation.js',
  );
  assert.equal(existsSync(preCommitValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const preCommitValidationSource = readFileSync(
    preCommitValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/pre-commit-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validatePreCommitConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const preCommitValue =/);
  assert.match(
    preCommitValidationSource,
    /export function validatePreCommitConfiguration/,
  );
  for (const moduleName of [
    'eslint',
    'file-placement',
    'max-file-lines',
    'prettier',
    'stylelint',
  ]) {
    assert.match(
      preCommitValidationSource,
      new RegExp(`from ['"]\\./${moduleName}-validation\\.js['"]`),
    );
  }
  assert.match(
    preCommitValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    preCommitValidationSource,
    /(?:protected-file-validation|normalizeProtectedFileConfiguration|validateProtectedFileConfigurationShape)/,
  );
  assert.doesNotMatch(
    preCommitValidationSource,
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
});

test('keeps protected-file configuration separate from staged quality validation', () => {
  const protectedFileValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'protected-file-validation.js',
  );
  assert.equal(existsSync(protectedFileValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const protectedFileValidationSource = readFileSync(
    protectedFileValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /validateProtectedFileConfigurationShape\(value, configPath\)/,
  );
  assert.match(
    configurationValidationSource,
    /normalizeProtectedFileConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /value\.rules\.map/);
  assert.match(protectedFileValidationSource, /export const SUPPORTED_LEVELS/);
  assert.match(
    protectedFileValidationSource,
    /export function validateProtectedFileConfigurationShape/,
  );
  assert.match(
    protectedFileValidationSource,
    /export function normalizeProtectedFileConfiguration/,
  );
  assert.match(
    protectedFileValidationSource,
    /from ['"]\.\/path-matching\.js['"]/,
  );
  assert.match(
    protectedFileValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    protectedFileValidationSource,
    /(?:eslint|prettier|stylelint|lint-staged)/i,
  );
  assert.doesNotMatch(
    protectedFileValidationSource,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('keeps notification configuration validation in the config module', () => {
  const notificationValidationPath = path.join(
    SOURCE_ROOT,
    'config',
    'notification-validation.js',
  );
  assert.equal(existsSync(notificationValidationPath), true);

  const configurationValidationSource = readFileSync(
    CONFIGURATION_VALIDATION_PATH,
    'utf8',
  );
  const notificationValidationSource = readFileSync(
    notificationValidationPath,
    'utf8',
  );

  assert.match(
    configurationValidationSource,
    /from ['"]\.\/notification-validation\.js['"]/,
  );
  assert.match(
    configurationValidationSource,
    /validateNotificationConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configurationValidationSource, /const notificationValue =/);
  assert.match(
    notificationValidationSource,
    /export function validateNotificationConfiguration/,
  );
  assert.match(notificationValidationSource, /from ['"]\.\/defaults\.js['"]/);
  assert.match(
    notificationValidationSource,
    /from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    notificationValidationSource,
    /(?:node:https|sendWecomNotification|buildNotificationText)/,
  );
  assert.doesNotMatch(
    notificationValidationSource,
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
});
