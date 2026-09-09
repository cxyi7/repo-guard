import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const source = (name) => readFileSync(path.join(SOURCE_ROOT, name), 'utf8');
const configuration = () => source('config/configuration-validation.js');
const checks = () => source('config/checks-validation.js');

test('keeps immutable platform defaults in their owning config module', () => {
  const defaults = source('config/defaults.js');
  for (const name of ['ARCHITECTURE', 'UNIT_TEST', 'FILE_PLACEMENT']) {
    assert.match(defaults, new RegExp(`export const DEFAULT_${name}_CONFIG`));
  }
  assert.match(defaults, /Object\.freeze/);
  assert.doesNotMatch(defaults, /^import /m);
  assert.doesNotMatch(defaults, /DEFAULT_CI_PIPELINE_CONFIG/);
});

test('keeps path normalization and rule matching in their owning config module', () => {
  const matching = source('config/path-matching.js');
  for (const name of ['normalizeGitPath', 'globToRegExp', 'matchRule']) {
    assert.match(matching, new RegExp(`export function ${name}`));
  }
  assert.doesNotMatch(matching, /^import /m);
  assert.match(
    source('index.js'),
    /from ['"]\.\/config\/path-matching\.js['"]/,
  );
  assert.match(
    source('policies/change-classification.js'),
    /from ['"]\.\.\/config\/path-matching\.js['"]/,
  );
});

test('keeps shared configuration validation primitives in the config module', () => {
  const primitives = source('config/validation-primitives.js');
  const workspace = source('config/workspace-configuration.js');
  for (const name of [
    'configValidationError',
    'normalizeRelativePattern',
    'validateCiReportPath',
  ]) {
    assert.match(primitives, new RegExp(`export function ${name}`));
  }
  assert.match(primitives, /export const CONFIG_FILE/);
  assert.match(primitives, /from ['"]\.\/path-matching\.js['"]/);
  assert.doesNotMatch(
    primitives,
    /from ['"][^'"]*(?:policies|orchestration)\//,
  );
  assert.match(
    workspace,
    /import\s*\{[^}]*CONFIG_FILE[^}]*\}\s*from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(
    workspace,
    /import\s*\{[^}]*validateCiReportPath[^}]*\}\s*from ['"]\.\/validation-primitives\.js['"]/,
  );
  assert.doesNotMatch(workspace, /^function configValidationError|^export const CONFIG_FILE/m);
  assert.match(
    source('orchestration/ci/runner.js'),
    /from ['"]\.\.\/\.\.\/config\/validation-primitives\.js['"]/,
  );
});

test('keeps configuration validation and loading in config modules without a root facade', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'config.js')), false);
  assert.match(
    source('index.js'),
    /from ['"]\.\/config\/configuration-loader\.js['"]/,
  );
  assert.match(
    source('index.js'),
    /from ['"]\.\/config\/project-configuration\.js['"]/,
  );
  assert.match(
    source('config/configuration-loader.js'),
    /from ['"]\.\/workspace-configuration\.js['"]/,
  );
  assert.match(
    source('config/configuration-loader.js'),
    /export function loadConfig/,
  );
  assert.match(
    source('config/project-configuration.js'),
    /from ['"]\.\/configuration-validation\.js['"]/,
  );
  assert.match(
    source('config/workspace-configuration.js'),
    /JSON\.parse\(readFileSync/,
  );
  assert.match(
    source('config/workspace-configuration.js'),
    /assertExceptionLifecycleCurrent/,
  );
  assert.match(
    source('config/workspace-configuration.js'),
    /from ['"]\.\/exception-lifecycle\.js['"]/,
  );
  assert.doesNotMatch(source('config/configuration-loader.js'), /from ['"][^'"]*policies\//);
  assert.match(configuration(), /export function validateConfigValue/);
  assert.match(configuration(), /export function validateConfig/);
  assert.match(
    configuration(),
    /validateConfigValue\(value, configPath, options\)/,
  );
  assert.doesNotMatch(configuration(), /(?:readFileSync|JSON\.parse)/);
  assert.doesNotMatch(
    configuration(),
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
});

test('keeps the root v2 configuration contract in its config module', () => {
  const root = source('config/root-configuration-validation.js');
  assert.match(configuration(), /from ['"]\.\/root-configuration-validation\.js['"]/);
  assert.match(
    configuration(),
    /validateRootConfigurationContract\(value, configPath\)/,
  );
  assert.match(root, /export function validateRootConfigurationContract/);
  assert.match(root, /export function assertProjectDocumentVersion/);
  assert.match(root, /config\/unsupported-version/);
  assert.match(root, /from ['"]\.\/validation-primitives\.js['"]/);
  for (const section of ['checks', 'repository', 'reporting', 'ci'])
    assert.match(root, new RegExp(`['"]${section}['"]`));
  assert.doesNotMatch(
    root,
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
  assert.doesNotMatch(root, /from ['"]\.\/[\w-]+-validation\.js['"]/);
});

const DOMAINS = [
  ['ci', 'validateCiConfiguration', 'root', 'value.ci'],
  ['exception', 'validateExceptionConfiguration', 'root', 'repository'],
  [
    'dependency-policy',
    'validateDependencyPolicyConfiguration',
    'root',
    'repository',
  ],
  ['architecture', 'validateArchitectureConfiguration', 'checks', 'checks'],
  ['execution-gate', 'validateExecutionGateConfiguration', 'checks', 'checks'],
  ['accessibility', 'validateAccessibilityConfiguration', 'checks', 'checks'],
  ['unit-test', 'validateUnitTestConfiguration', 'checks', null],
  ['file-placement', 'validateFilePlacementConfiguration', 'checks', 'checks'],
  ['max-file-lines', 'validateMaxFileLinesConfiguration', 'checks', 'checks'],
  ['stylelint', 'validateStylelintConfiguration', 'checks', null],
  ['prettier', 'validatePrettierConfiguration', 'checks', 'checks'],
  ['eslint', 'validateEslintConfiguration', 'checks', 'checks'],
  ['notification', 'validateNotificationConfiguration', 'root', 'reporting'],
];

for (const [moduleName, exportName, owner, argument] of DOMAINS) {
  test(`keeps ${moduleName} validation and its v2 caller in the owning config modules`, () => {
    const caller = owner === 'root' ? configuration() : checks();
    const domain = source(`config/${moduleName}-validation.js`);
    assert.match(
      caller,
      new RegExp(`from ['"]\\./${moduleName}-validation\\.js['"]`),
    );
    assert.match(
      caller,
      new RegExp(
        `${exportName}\\(\\s*${argument ? `${argument.replaceAll('.', '\\.')},\\s*configPath` : '\\{'}`,
      ),
    );
    assert.match(domain, new RegExp(`export function ${exportName}`));
    assert.match(domain, /from ['"]\.\/defaults\.js['"]/);
    assert.match(domain, /from ['"]\.\/validation-primitives\.js['"]/);
    assert.doesNotMatch(domain, /from ['"][^'"]*(?:commands|orchestration)\//);
    if (['unit-test', 'max-file-lines'].includes(moduleName)) {
      assert.match(domain, /from ['"]\.\/path-matching\.js['"]/);
    }
    if (moduleName === 'notification') {
      assert.doesNotMatch(domain, /(?:node:https|sendWecomNotification|buildNotificationText)/);
      assert.doesNotMatch(domain, /from ['"][^'"]*(?:integrations|policies)\//);
    }
  });
}

test('keeps all engineering checks in one version-independent checks aggregate', () => {
  assert.equal(
    existsSync(path.join(SOURCE_ROOT, 'config/pre-commit-validation.js')),
    false,
  );
  assert.match(
    configuration(),
    /validateChecksConfiguration\(value\.checks, project, configPath\)/,
  );
  assert.match(checks(), /export function validateChecksConfiguration/);
  assert.match(configuration(), /from ['"]\.\/checks-validation\.js['"]/);
  assert.match(checks(), /from ['"]\.\/validation-primitives\.js['"]/);
  const domainValues = [
    'ci', 'externalGates', 'exceptions', 'dependencyPolicy', 'architecture',
    'build', 'lighthouse', 'typeCheck', 'accessibilityTest', 'unitTest',
    'filePlacement', 'maxFileLines', 'stylelint', 'prettier', 'eslint', 'notification',
  ];
  for (const caller of [configuration(), checks()]) {
    assert.doesNotMatch(caller, new RegExp(`\\b(?:const|let)\\s+(?:${domainValues.join('|')})Value\\s*=`));
  }
  assert.doesNotMatch(
    checks(),
    /(?:protected-file-validation|normalizeProtectedFileConfiguration|validateProtectedFileConfigurationShape)/,
  );
  assert.doesNotMatch(checks(), /(?:configVersion|preCommit|version:\s*1)/);
  assert.doesNotMatch(
    checks(),
    /from ['"][^'"]*(?:commands|integrations|orchestration|policies)\//,
  );
});

test('keeps protected-file configuration separate from engineering check validation', () => {
  const protectedFiles = source('config/protected-file-validation.js');
  assert.match(
    configuration(),
    /validateProtectedFileConfigurationShape\(protectedFiles, configPath\)/,
  );
  assert.match(
    configuration(),
    /normalizeProtectedFileConfiguration\(protectedFiles, configPath\)/,
  );
  for (const name of [
    'validateProtectedFileConfigurationShape',
    'normalizeProtectedFileConfiguration',
  ]) {
    assert.match(protectedFiles, new RegExp(`export function ${name}`));
  }
  assert.match(protectedFiles, /export const SUPPORTED_LEVELS/);
  assert.match(protectedFiles, /from ['"]\.\/path-matching\.js['"]/);
  assert.match(protectedFiles, /from ['"]\.\/validation-primitives\.js['"]/);
  assert.match(configuration(), /from ['"]\.\/protected-file-validation\.js['"]/);
  assert.doesNotMatch(configuration(), /(?:value\.repository|repository|protectedFiles)\.rules\.map/);
  assert.doesNotMatch(
    protectedFiles,
    /(?:eslint|prettier|stylelint|lint-staged)/i,
  );
  assert.doesNotMatch(
    protectedFiles,
    /from ['"][^'"]*(?:commands|orchestration)\//,
  );
});

test('所有运行入口只使用 v2，不保留旧配置解析器或转换入口', () => {
  for (const file of [
    'config/migration/legacy-config.js',
    'config/migration/legacy-defaults.js',
    'config/migration/legacy-root-validation.js',
    'config/migration/legacy-pipeline-validation.js',
    'orchestration/setup/migration-support.js',
    'operations/gitlab/legacy-upgrade.js',
  ]) {
    assert.equal(existsSync(path.join(SOURCE_ROOT, file)), false, file);
  }
  const runtimeFiles = readdirSync(SOURCE_ROOT, { recursive: true }).filter(
    (file) => file.endsWith('.js'),
  );
  for (const file of runtimeFiles) {
    const text = source(file);
    assert.doesNotMatch(text, /migration\/legacy-|migration-support|legacy-upgrade/, file);
    assert.doesNotMatch(text, /\b(?:migrateLegacyConfig|migrateProjectConfig|runMigrate|synchronizeMigrationSupport|configVersion)\b/, file);
    assert.doesNotMatch(text, /guard:migrate/, file);
  }
});
