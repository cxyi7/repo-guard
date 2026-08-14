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
  'accessibility-test-runner.js',
  'architecture-runner.js',
  'ci-runner.js',
  'coverage-runner.js',
  'dependency-policy.js',
  'eslint-runner.js',
  'prettier-runner.js',
  'quality-runner.js',
  'stylelint-runner.js',
  'unit-test-runner.js',
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
