import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cruise } from 'dependency-cruiser';
import dependencyCruiserConfig from '../.dependency-cruiser.cjs';

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, 'src');

const EXPECTED_BOUNDARY_RULES = Object.freeze([
  'core-does-not-depend-on-platform-layers',
  'gate-domains-do-not-deep-import-each-other',
  'gates-do-not-depend-on-orchestration',
  'gates-do-not-import-report-renderers',
  'integrations-do-not-depend-on-policy-layers',
  'integrations-do-not-import-policy-or-rendering',
  'no-circular-dependencies',
  'no-unresolvable-imports',
  'orchestration-entrypoints-do-not-call-integrations-directly',
]);

const REVIEWED_TOP_LEVEL_GATE_FILES = Object.freeze([
  'native-result.js',
  'platform-capabilities.js',
  'registry.js',
]);

const LEGACY_TOP_LEVEL_ARCHITECTURE_FILES = Object.freeze([
  'quality-runner.js',
]);

const REVIEWED_TOP_LEVEL_PROJECT_FILES = Object.freeze([]);

function javascriptFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  });
}

function writeFixture(root, relativePath, source = 'export const fixture = true;\n') {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source, 'utf8');
}

test('enforces every declared platform dependency direction as an error', async () => {
  assert.deepEqual(
    dependencyCruiserConfig.forbidden.map((rule) => rule.name).sort(),
    EXPECTED_BOUNDARY_RULES,
  );
  assert.equal(
    dependencyCruiserConfig.forbidden.every((rule) => rule.severity === 'error'),
    true,
  );

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'repo-guard-boundaries-'));
  try {
    const targets = [
      'src/core/report/renderer.js',
      'src/gates/security/gate.js',
      'src/gates/testing/gate.js',
      'src/integrations/npm/tool.js',
      'src/orchestration/runner.js',
    ];
    for (const target of targets) writeFixture(fixtureRoot, target);

    writeFixture(fixtureRoot, 'src/core/invalid.js', "import '../gates/security/gate.js';\n");
    writeFixture(fixtureRoot, 'src/core/unresolved.js', "import './missing.js';\n");
    writeFixture(fixtureRoot, 'src/core/cycle-a.js', "import './cycle-b.js';\n");
    writeFixture(fixtureRoot, 'src/core/cycle-b.js', "import './cycle-a.js';\n");
    writeFixture(fixtureRoot, 'src/gates/security/orchestration.js', "import '../../orchestration/runner.js';\n");
    writeFixture(fixtureRoot, 'src/gates/security/report.js', "import '../../core/report/renderer.js';\n");
    writeFixture(fixtureRoot, 'src/gates/security/cross-domain.js', "import '../testing/gate.js';\n");
    writeFixture(fixtureRoot, 'src/integrations/npm/gate.js', "import '../../gates/testing/gate.js';\n");
    writeFixture(fixtureRoot, 'src/integrations/npm/report.js', "import '../../core/report/renderer.js';\n");
    writeFixture(fixtureRoot, 'src/orchestration/integration.js', "import '../integrations/npm/tool.js';\n");

    const result = await cruise(['src'], {
      ...dependencyCruiserConfig.options,
      baseDir: fixtureRoot,
      outputType: 'json',
      ruleSet: { forbidden: dependencyCruiserConfig.forbidden },
      validate: true,
    });
    const report = JSON.parse(result.output);
    assert.deepEqual(
      [...new Set(report.summary.violations.map((violation) => violation.rule.name))].sort(),
      EXPECTED_BOUNDARY_RULES,
    );
    assert.equal(report.summary.error >= EXPECTED_BOUNDARY_RULES.length, true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('keeps architecture enforcement in the standard repository check', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['architecture:check'],
    'depcruise --config .dependency-cruiser.cjs --output-type err-long src',
  );
  assert.match(packageJson.scripts.check, /npm run architecture:check/);
  assert.equal(packageJson.devDependencies['dependency-cruiser'], '17.4.3');
});

test('does not add new top-level runner, policy, or parser files', () => {
  const architectureFiles = readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /(?:runner|policy|parser)\.js$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(architectureFiles, LEGACY_TOP_LEVEL_ARCHITECTURE_FILES);

  const topLevelGateFiles = readdirSync(path.join(SOURCE_ROOT, 'gates'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(topLevelGateFiles, REVIEWED_TOP_LEVEL_GATE_FILES);
});

test('keeps project dependency discovery in core/project without a root compatibility path', () => {
  const projectFiles = readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /(?:package|project)\.js$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(projectFiles, REVIEWED_TOP_LEVEL_PROJECT_FILES);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'project-package.js')), false);
  assert.equal(
    existsSync(path.join(SOURCE_ROOT, 'core', 'project', 'package.js')),
    true,
  );
});

test('separates Stylelint project facts from gate-owned setup readiness', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'stylelint-project.js')), false);
  const integrationPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'stylelint',
    'project.js',
  );
  const setupPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'stylelint-setup.js');
  assert.equal(existsSync(integrationPath), true);
  assert.equal(existsSync(setupPath), true);
  assert.doesNotMatch(
    readFileSync(integrationPath, 'utf8'),
    /detectProjectStylelintSetup/,
  );
  assert.match(
    readFileSync(setupPath, 'utf8'),
    /integrations\/stylelint\/project\.js/,
  );
});

test('keeps shared Vue template parsing in an integration without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'vue-template-parser.js')), false);
  const parserPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'vue',
    'template-parser.js',
  );
  assert.equal(existsSync(parserPath), true);

  const parserSource = readFileSync(parserPath, 'utf8');
  assert.doesNotMatch(
    parserSource,
    /\b(?:createGateResult|createFinding|configurationError|executionError)\b/,
  );
  assert.match(parserSource, /export function findVueTemplateAttributes/);
  assert.match(parserSource, /export function findVueTemplateElements/);
  assert.match(parserSource, /export function sourceLocation/);
});

test('keeps Lighthouse project inspection in its integration without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'lighthouse-project.js')), false);
  assert.equal(
    existsSync(path.join(SOURCE_ROOT, 'integrations', 'lighthouse', 'project.js')),
    true,
  );
});

test('separates Lighthouse execution facts from gate decisions without a root runner', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'lighthouse-runner.js')), false);
  const executionPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'lighthouse',
    'execution.js',
  );
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'lighthouse-gate.js');
  assert.equal(existsSync(executionPath), true);
  assert.equal(existsSync(gatePath), true);

  const executionSource = readFileSync(executionPath, 'utf8');
  assert.doesNotMatch(
    executionSource,
    /\b(?:createGateResult|processFailureFinding|executionError)\b/,
  );
  assert.match(
    readFileSync(gatePath, 'utf8'),
    /integrations\/lighthouse\/execution\.js/,
  );
});

test('separates build execution facts from gate decisions without a root runner', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'build-runner.js')), false);
  const integrationPath = path.join(SOURCE_ROOT, 'integrations', 'npm', 'build.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'build-gate.js');
  const setupPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'build-setup.js');
  assert.equal(existsSync(integrationPath), true);
  assert.equal(existsSync(gatePath), true);
  assert.equal(existsSync(setupPath), true);

  const integrationSource = readFileSync(integrationPath, 'utf8');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|processFailureFinding|executionError)\b/,
  );
  assert.match(integrationSource, /export function executeProjectBuild/);
  assert.match(
    readFileSync(gatePath, 'utf8'),
    /integrations\/npm\/build\.js/,
  );
  assert.match(
    readFileSync(setupPath, 'utf8'),
    /integrations\/npm\/build\.js/,
  );
});

test('separates typecheck execution facts from gate decisions without a root runner', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'typecheck-runner.js')), false);
  const integrationPath = path.join(SOURCE_ROOT, 'integrations', 'npm', 'typecheck.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'typecheck-gate.js');
  const setupPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'typecheck-setup.js');
  assert.equal(existsSync(integrationPath), true);
  assert.equal(existsSync(gatePath), true);
  assert.equal(existsSync(setupPath), true);

  const integrationSource = readFileSync(integrationPath, 'utf8');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|processFailureFinding|executionError)\b/,
  );
  assert.match(integrationSource, /export function executeProjectTypeCheck/);
  assert.match(
    readFileSync(gatePath, 'utf8'),
    /integrations\/npm\/typecheck\.js/,
  );
  assert.match(
    readFileSync(setupPath, 'utf8'),
    /integrations\/npm\/typecheck\.js/,
  );
});

test('separates dependency-cruiser execution facts from architecture gate decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'architecture-runner.js')), false);
  const integrationPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'dependency-cruiser',
    'architecture.js',
  );
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'architecture-gate.js');
  const setupPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'architecture-setup.js');
  assert.equal(existsSync(integrationPath), true);
  assert.equal(existsSync(gatePath), true);
  assert.equal(existsSync(setupPath), true);

  const integrationSource = readFileSync(integrationPath, 'utf8');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|architectureRepairAdvice|processOutputDiagnostics)\b/,
  );
  assert.match(integrationSource, /export function executeArchitectureAnalysis/);
  assert.match(integrationSource, /export function parseArchitectureReport/);
  assert.match(
    readFileSync(gatePath, 'utf8'),
    /integrations\/dependency-cruiser\/architecture\.js/,
  );
  assert.match(
    readFileSync(setupPath, 'utf8'),
    /integrations\/dependency-cruiser\/architecture\.js/,
  );
});

test('separates axe project and execution facts from accessibility test decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'accessibility-test-runner.js')), false);
  const axeProjectPath = path.join(SOURCE_ROOT, 'integrations', 'axe', 'project.js');
  const executionPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'npm',
    'accessibility.js',
  );
  const gatePath = path.join(
    SOURCE_ROOT,
    'gates',
    'testing',
    'accessibility-test-gate.js',
  );
  const setupPath = path.join(
    SOURCE_ROOT,
    'gates',
    'testing',
    'accessibility-test-setup.js',
  );
  for (const target of [axeProjectPath, executionPath, gatePath, setupPath]) {
    assert.equal(existsSync(target), true);
  }

  const integrationSource = `${readFileSync(axeProjectPath, 'utf8')}\n${readFileSync(executionPath, 'utf8')}`;
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|processFailureFinding|remediation|problems)\b/,
  );
  assert.match(readFileSync(gatePath, 'utf8'), /integrations\/npm\/accessibility\.js/);
  assert.match(readFileSync(gatePath, 'utf8'), /\.\/accessibility-test-setup\.js/);
  assert.match(readFileSync(setupPath, 'utf8'), /integrations\/axe\/project\.js/);
});

test('separates Vitest coverage facts from testing gate decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'coverage-runner.js')), false);
  const integrationPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'vitest',
    'coverage.js',
  );
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'testing', 'coverage-gate.js');
  assert.equal(existsSync(integrationPath), true);
  assert.equal(existsSync(gatePath), true);

  const integrationSource = readFileSync(integrationPath, 'utf8');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:coverageFinding|remediation|threshold|passed)\b/,
  );
  assert.match(integrationSource, /export function inspectCoverageReports/);
  assert.match(
    readFileSync(gatePath, 'utf8'),
    /integrations\/vitest\/coverage\.js/,
  );
});

test('separates Vitest project and execution facts from unit-test policy decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'unit-test-runner.js')), false);
  const projectPath = path.join(SOURCE_ROOT, 'integrations', 'vitest', 'project.js');
  const executionPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'vitest',
    'execution.js',
  );
  const sourceAnalysisPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'vitest',
    'source-analysis.js',
  );
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'testing', 'unit-test-gate.js');
  const policyPath = path.join(SOURCE_ROOT, 'gates', 'testing', 'unit-test-policy.js');
  const setupPath = path.join(SOURCE_ROOT, 'gates', 'testing', 'unit-test-setup.js');
  for (const target of [
    projectPath,
    executionPath,
    sourceAnalysisPath,
    gatePath,
    policyPath,
    setupPath,
  ]) {
    assert.equal(existsSync(target), true);
  }

  const integrationSource = [projectPath, executionPath, sourceAnalysisPath]
    .map((target) => readFileSync(target, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|changeSetEntries|remediation|unitTestPolicyFindings)\b/,
  );
  assert.match(integrationSource, /export function executeUnitTests/);
  assert.match(readFileSync(gatePath, 'utf8'), /integrations\/vitest\/execution\.js/);
  assert.match(readFileSync(setupPath, 'utf8'), /integrations\/vitest\/project\.js/);
  assert.doesNotMatch(readFileSync(policyPath, 'utf8'), /\bspawnSync\b/);
});

test('separates package and staged metadata facts from dependency policy decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'dependency-policy.js')), false);
  const npmPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'npm',
    'package-metadata.js',
  );
  const gitPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'git',
    'staged-package-metadata.js',
  );
  const gatePath = path.join(
    SOURCE_ROOT,
    'gates',
    'repository',
    'dependency-policy.js',
  );
  for (const target of [npmPath, gitPath, gatePath]) {
    assert.equal(existsSync(target), true);
  }

  const integrationSource = `${readFileSync(npmPath, 'utf8')}\n${readFileSync(gitPath, 'utf8')}`;
  assert.doesNotMatch(
    integrationSource,
    /\b(?:findStructuredException|inspectDeclarations|compareLockfile|remediation)\b/,
  );
  assert.match(integrationSource, /export function readStagedPackageMetadata/);
  assert.match(integrationSource, /export function readPackageMetadataFile/);
  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(gateSource, /integrations\/git\/staged-package-metadata\.js/);
  assert.match(gateSource, /integrations\/npm\/package-metadata\.js/);
  assert.doesNotMatch(gateSource, /\b(?:mkdtempSync|writeFileSync|rmSync|runGit)\b/);
});

test('separates ESLint project and execution facts from quality policy decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'eslint-runner.js')), false);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'eslint-config.js')), false);
  const integrationPaths = [
    path.join(SOURCE_ROOT, 'integrations', 'eslint', 'project.js'),
    path.join(SOURCE_ROOT, 'integrations', 'eslint', 'execution.js'),
  ];
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'eslint-gate.js');
  const presetPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'eslint-preset.js');
  for (const target of [...integrationPaths, gatePath, presetPath]) {
    assert.equal(existsSync(target), true);
  }

  const integrationSource = integrationPaths
    .map((target) => readFileSync(target, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|blockingFindings|createRepoGuardEslintConfig|restoreFileContents)\b/,
  );
  assert.match(integrationSource, /export async function loadProjectEslint/);
  assert.match(integrationSource, /export async function prepareProjectEslintExecution/);
  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(gateSource, /integrations\/eslint\/execution\.js/);
  assert.match(gateSource, /integrations\/eslint\/project\.js/);
  assert.doesNotMatch(gateSource, /\b(?:pathToFileURL|outputFixes|isPathIgnored)\b/);
});

test('separates Prettier project and formatting facts from quality decisions', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'prettier-runner.js')), false);
  const integrationPaths = [
    path.join(SOURCE_ROOT, 'integrations', 'prettier', 'project.js'),
    path.join(SOURCE_ROOT, 'integrations', 'prettier', 'execution.js'),
  ];
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'prettier-gate.js');
  for (const target of [...integrationPaths, gatePath]) {
    assert.equal(existsSync(target), true);
  }

  const integrationSource = integrationPaths
    .map((target) => readFileSync(target, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|collectFormatting|captureFileContents|restoreFileContents)\b/,
  );
  assert.match(integrationSource, /export async function loadProjectPrettier/);
  assert.match(integrationSource, /export function prepareProjectPrettierExecution/);
  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(gateSource, /integrations\/prettier\/execution\.js/);
  assert.match(gateSource, /integrations\/prettier\/project\.js/);
  assert.doesNotMatch(
    gateSource,
    /\bprettier\.(?:getFileInfo|resolveConfig|format)\b|\b(?:pathToFileURL|writeFileSync)\b/,
  );
});

test('separates Stylelint project and execution facts from quality policy', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'stylelint-runner.js')), false);
  const integrationPaths = [
    path.join(SOURCE_ROOT, 'integrations', 'stylelint', 'project.js'),
    path.join(SOURCE_ROOT, 'integrations', 'stylelint', 'execution.js'),
  ];
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'stylelint-gate.js');
  for (const target of [...integrationPaths, gatePath]) {
    assert.equal(existsSync(target), true);
  }

  const integrationSource = integrationPaths
    .map((target) => readFileSync(target, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    integrationSource,
    /\b(?:createGateResult|findStructuredException|stylelintFindings|restoreFileContents)\b/,
  );
  assert.match(integrationSource, /export async function loadProjectStylelint/);
  assert.match(integrationSource, /export async function executeProjectStylelint/);
  assert.match(integrationSource, /bypassProjectIgnores = false/);
  assert.match(integrationSource, /ignoreDisables = false/);
  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(gateSource, /integrations\/stylelint\/execution\.js/);
  assert.match(gateSource, /integrations\/stylelint\/project\.js/);
  assert.match(gateSource, /bypassProjectIgnores: true/);
  assert.match(gateSource, /ignoreDisables: true/);
  assert.doesNotMatch(
    gateSource,
    /\bstylelint\.(?:lint|resolveConfig)\b|\b(?:pathToFileURL|randomUUID|readFileSync)\b/,
  );
});

test('keeps CI execution and report persistence inside orchestration', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'ci-runner.js')), false);
  const runnerPath = path.join(SOURCE_ROOT, 'orchestration', 'ci', 'runner.js');
  const reportPath = path.join(SOURCE_ROOT, 'orchestration', 'ci', 'report.js');
  assert.equal(existsSync(runnerPath), true);
  assert.equal(existsSync(reportPath), true);

  const runnerSource = readFileSync(runnerPath, 'utf8');
  const reportSource = readFileSync(reportPath, 'utf8');
  assert.match(runnerSource, /\.\/report\.js/);
  assert.doesNotMatch(runnerSource, /\b(?:mkdirSync|writeFileSync|lstatSync)\b/);
  assert.match(reportSource, /export function writeCiReport/);
  assert.doesNotMatch(reportSource, /\b(?:orchestratePlan|createProjectGateRegistry)\b/);
});

test('keeps Lighthouse ignore management in setup orchestration without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'lighthouse-ignore.js')), false);
  assert.equal(
    existsSync(path.join(
      SOURCE_ROOT,
      'orchestration',
      'setup',
      'lighthouse-ignore.js',
    )),
    true,
  );
});

test('keeps structured process guidance with results and core/report limited to renderers', () => {
  assert.equal(
    existsSync(path.join(SOURCE_ROOT, 'core', 'report', 'guidance-catalog.js')),
    false,
  );
  assert.equal(
    existsSync(path.join(SOURCE_ROOT, 'core', 'result', 'process-failure-guidance.js')),
    true,
  );
  const reportFiles = readdirSync(path.join(SOURCE_ROOT, 'core', 'report'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert.ok(reportFiles.length > 0);
  assert.ok(reportFiles.every((file) => /renderer\.js$/.test(file)));
});

test('keeps gates free of process ownership and Git range collection', () => {
  for (const file of javascriptFiles(path.join(SOURCE_ROOT, 'gates'))) {
    const source = readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file);
    assert.doesNotMatch(source, /\bprocess\.(?:exit|exitCode)\b/, relative);
    assert.doesNotMatch(
      source,
      /\b(?:collect(?:PrePush|Revision|Staged|WorkingTree)Changes|getStagedFiles|resolveCiRange)\b/,
      relative,
    );
  }
});

test('keeps package exports on reviewed contracts and schemas', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.exports, {
    '.': './src/index.js',
    './config.schema.json': './config.schema.json',
    './external-report.schema.json': './external-report.schema.json',
    './gate-result.schema.json': './gate-result.schema.json',
  });

  const publicEntry = readFileSync(path.join(SOURCE_ROOT, 'index.js'), 'utf8');
  assert.doesNotMatch(
    publicEntry,
    /from ['"]\.\/(?:gates|integrations|orchestration)\//,
  );
  assert.doesNotMatch(publicEntry, /from ['"][^'"]*(?:runner|policy|parser)\.js['"]/);
});
