import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const LEGACY_TOP_LEVEL_ARCHITECTURE_FILES = Object.freeze([]);

const REVIEWED_TOP_LEVEL_PROJECT_FILES = Object.freeze([]);

const REVIEWED_PACKAGE_FILES = Object.freeze([
  'bin',
  'scripts',
  'src',
  'config.schema.json',
  'external-report.schema.json',
  'gate-result.schema.json',
  'CHANGELOG.md',
  'README.md',
]);

const REVIEWED_PACKED_ROOTS = Object.freeze([
  'CHANGELOG.md',
  'README.md',
  'bin',
  'config.schema.json',
  'external-report.schema.json',
  'gate-result.schema.json',
  'package.json',
  'scripts',
  'src',
]);

const REVIEWED_SOURCE_DIRECTORIES = Object.freeze([
  'commands',
  'config',
  'core',
  'gates',
  'git',
  'integrations',
  'orchestration',
  'policies',
]);

const REVIEWED_SOURCE_FILES = Object.freeze([
  'cli.js',
  'config.js',
  'index.js',
]);

const REVIEWED_CLI_LAUNCHER = `#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(\`repo-guard failed: \${error.message}\`);
    process.exitCode = 1;
  });
`;

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

function assertModuleImportIsInert(
  modulePath,
  fixturePrefix,
  importLabel,
  { allowModuleResolution = false } = {},
) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), fixturePrefix));
  const probe = `
    import childProcess from 'node:child_process';
    import dgram from 'node:dgram';
    import dns from 'node:dns';
    import fs from 'node:fs';
    import http from 'node:http';
    import https from 'node:https';
    import net from 'node:net';
    import tls from 'node:tls';
    import { syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';

    const importLabel = process.argv[2];
    const allowModuleResolution = process.argv[3] === 'allow-module-resolution';
    const normalizedDependencyRoot = process.argv[4].replaceAll('\\\\', '/');
    const dependencyRoot = normalizedDependencyRoot.endsWith('/')
      ? normalizedDependencyRoot.slice(0, -1)
      : normalizedDependencyRoot;
    const forbidden = (operation) => () => {
      throw new TypeError(\`\${importLabel} import attempted \${operation}\`);
    };
    const replaceFunctions = (target, names, prefix) => {
      for (const name of names) {
        if (typeof target[name] === 'function') target[name] = forbidden(\`\${prefix}.\${name}\`);
      }
    };

    const dependencyReadFunctions = new Map([
      ['readFileSync', fs.readFileSync.bind(fs)],
      ['realpathSync', fs.realpathSync.bind(fs)],
    ]);
    const blockedFsFunctions = [
      'access', 'accessSync', 'appendFile', 'appendFileSync', 'chmod', 'chmodSync',
      'chown', 'chownSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
      'createReadStream', 'createWriteStream', 'existsSync', 'link', 'linkSync',
      'lstat', 'lstatSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync',
      'readdir', 'readdirSync', 'readFile', 'readFileSync', 'readlink',
      'readlinkSync', 'realpath',
      'realpathSync', 'rename', 'renameSync', 'rm', 'rmSync', 'rmdir',
      'rmdirSync', 'stat', 'statSync', 'symlink', 'symlinkSync', 'truncate',
      'truncateSync', 'unlink', 'unlinkSync', 'utimes', 'utimesSync', 'write',
      'writeFile', 'writeFileSync', 'writeSync', 'writev', 'writevSync',
    ].filter((name) => !allowModuleResolution || !dependencyReadFunctions.has(name));
    replaceFunctions(fs, blockedFsFunctions, 'fs');
    if (allowModuleResolution) {
      for (const [name, original] of dependencyReadFunctions) {
        fs[name] = (target, ...argumentsList) => {
          const normalizedTarget = String(target).replaceAll('\\\\', '/');
          if (normalizedTarget.startsWith(\`\${dependencyRoot}/\`)) {
            return original(target, ...argumentsList);
          }
          return forbidden(\`fs.\${name}\`)();
        };
      }
    }
    replaceFunctions(fs.promises, [
      'access', 'appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'link',
      'lstat', 'mkdir', 'mkdtemp', 'open', 'readdir', 'readFile', 'readlink',
      'realpath', 'rename', 'rm', 'rmdir', 'stat', 'symlink', 'truncate',
      'unlink', 'utimes', 'writeFile',
    ], 'fs.promises');
    replaceFunctions(childProcess, [
      'exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync',
    ], 'child_process');
    replaceFunctions(http, ['ClientRequest', 'createServer', 'get', 'request'], 'http');
    replaceFunctions(https, ['createServer', 'get', 'request'], 'https');
    replaceFunctions(net, ['connect', 'createConnection', 'createServer'], 'net');
    replaceFunctions(net.Socket.prototype, ['connect'], 'net.Socket');
    replaceFunctions(tls, ['connect', 'createServer'], 'tls');
    replaceFunctions(dgram, ['createSocket'], 'dgram');
    replaceFunctions(dns, [
      'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
      'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
      'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse',
    ], 'dns');
    replaceFunctions(dns.promises, [
      'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
      'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
      'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse',
    ], 'dns.promises');
    globalThis.fetch = forbidden('fetch');
    if ('WebSocket' in globalThis) globalThis.WebSocket = forbidden('WebSocket');
    process.exit = forbidden('process.exit');
    syncBuiltinESMExports();

    await import(pathToFileURL(process.argv[1]).href);
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (process.exitCode !== undefined) {
      throw new TypeError(\`\${importLabel} import set process.exitCode to \${process.exitCode}\`);
    }
    process.stdout.write('MODULE_IMPORT_OK\\n');
  `;

  try {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      probe,
      modulePath,
      importLabel,
      allowModuleResolution ? 'allow-module-resolution' : 'strict',
      path.join(ROOT, 'node_modules'),
    ], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, 'MODULE_IMPORT_OK\n');
    assert.equal(result.stderr, '');
    assert.deepEqual(readdirSync(fixtureRoot), []);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
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

test('keeps file snapshot lifecycle in core execution without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'file-snapshot.js')), false);
  const snapshotPath = path.join(
    SOURCE_ROOT,
    'core',
    'execution',
    'file-snapshot.js',
  );
  assert.equal(existsSync(snapshotPath), true);

  const snapshotSource = readFileSync(snapshotPath, 'utf8');
  assert.match(snapshotSource, /export function captureFileContents/);
  assert.match(snapshotSource, /export function restoreFileContents/);
  assert.doesNotMatch(snapshotSource, /\b(?:GateResult|finding|policy|registry)\b/i);
});

test('keeps staged file normalization in core execution without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'staged-files.js')), false);
  const stagedFilesPath = path.join(
    SOURCE_ROOT,
    'core',
    'execution',
    'staged-files.js',
  );
  assert.equal(existsSync(stagedFilesPath), true);

  const stagedFilesSource = readFileSync(stagedFilesPath, 'utf8');
  assert.match(stagedFilesSource, /export function normalizeStagedFiles/);
  assert.match(stagedFilesSource, /staged-files\/outside-repository/);
  assert.doesNotMatch(stagedFilesSource, /\b(?:GateResult|finding|policy|registry)\b/i);
});

test('keeps staged quality execution and lint-staged isolation in separate pre-commit modules', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'quality-runner.js')), false);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'quality-gate.js')), false);
  const runnerPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'quality-runner.js',
  );
  const lintStagedGatePath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'lint-staged-gate.js',
  );
  const protectedPlanPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'protected-plan.js',
  );
  assert.equal(existsSync(runnerPath), true);
  assert.equal(existsSync(lintStagedGatePath), true);
  assert.equal(existsSync(protectedPlanPath), true);

  const runnerSource = readFileSync(runnerPath, 'utf8');
  const lintStagedGateSource = readFileSync(lintStagedGatePath, 'utf8');
  const protectedPlanSource = readFileSync(protectedPlanPath, 'utf8');
  assert.match(runnerSource, /plan: preCommitQualityPlan/);
  assert.match(runnerSource, /registry: gateRegistry/);
  assert.match(runnerSource, /createGateContext/);
  assert.match(runnerSource, /writeGateResultConsole/);
  assert.doesNotMatch(
    runnerSource,
    /\blint-staged\b|run\w+Project|quality\.typecheck|quality\.lighthouse/,
  );
  assert.match(lintStagedGateSource, /from 'lint-staged'/);
  assert.match(lintStagedGateSource, /'quality-files'/);
  assert.match(lintStagedGateSource, /allowEmpty: false/);
  assert.match(lintStagedGateSource, /concurrent: false/);
  assert.match(lintStagedGateSource, /relative: false/);
  assert.match(lintStagedGateSource, /stash: true/);
  assert.doesNotMatch(
    lintStagedGateSource,
    /\b(?:preCommitPolicyPlan|runQualityExecution|GateResult|protectedFilesGate)\b/,
  );
  assert.doesNotMatch(protectedPlanSource, /lint-staged|runQualityGate/);
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

test('keeps Vue component interaction analysis in an integration without a root helper', () => {
  assert.equal(
    existsSync(path.join(SOURCE_ROOT, 'vue-component-interaction.js')),
    false,
  );
  const analysisPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'vue',
    'component-interaction.js',
  );
  assert.equal(existsSync(analysisPath), true);

  const analysisSource = readFileSync(analysisPath, 'utf8');
  assert.match(analysisSource, /\.\/template-parser\.js/);
  assert.match(analysisSource, /export function findVueInteractionEntries/);
  assert.match(
    analysisSource,
    /export function analyzeVueComponentInteractionTest/,
  );
  assert.doesNotMatch(
    analysisSource,
    /\b(?:createGateResult|changeSetEntries|unitTestPolicyFindings|remediation)\b/,
  );
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

test('keeps staged fingerprints in the Git integration without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'fingerprint.js')), false);
  const fingerprintPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'git',
    'staged-fingerprint.js',
  );
  assert.equal(existsSync(fingerprintPath), true);

  const fingerprintSource = readFileSync(fingerprintPath, 'utf8');
  assert.match(fingerprintSource, /export function createStagedFingerprint/);
  assert.match(fingerprintSource, /\['write-tree'\]/);
  assert.doesNotMatch(fingerprintSource, /\b(?:GateResult|finding|policy|registry)\b/i);
});

test('keeps repository-local state persistence in the Git integration without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'state.js')), false);
  const statePath = path.join(
    SOURCE_ROOT,
    'integrations',
    'git',
    'repository-state.js',
  );
  assert.equal(existsSync(statePath), true);

  const stateSource = readFileSync(statePath, 'utf8');
  assert.match(stateSource, /export function notificationWasSent/);
  assert.match(stateSource, /export function saveNotificationState/);
  assert.match(stateSource, /export function readCommitMessageState/);
  assert.match(stateSource, /export function saveCommitMessageState/);
  assert.match(stateSource, /export function clearCommitMessageState/);
  assert.match(stateSource, /repo-guard-notified\.json/);
  assert.match(stateSource, /repo-guard-commit-message\.json/);
  assert.doesNotMatch(stateSource, /\b(?:GateResult|finding|policy|registry)\b/i);
});

test('separates Git command execution from repository discovery without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'git.js')), false);
  const executionPath = path.join(SOURCE_ROOT, 'git', 'execution.js');
  const repositoryPath = path.join(SOURCE_ROOT, 'git', 'repository.js');
  assert.equal(existsSync(executionPath), true);
  assert.equal(existsSync(repositoryPath), true);

  const executionSource = readFileSync(executionPath, 'utf8');
  const repositorySource = readFileSync(repositoryPath, 'utf8');
  assert.match(executionSource, /export function runGit/);
  assert.match(executionSource, /export function gitValue/);
  assert.doesNotMatch(
    executionSource,
    /\b(?:configurationError|findRepositoryRoot|resolveGitPath)\b/,
  );
  assert.doesNotMatch(
    executionSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration|policies)\//,
  );
  assert.match(repositorySource, /export function findRepositoryRoot/);
  assert.match(repositorySource, /export function resolveGitPath/);
  assert.match(repositorySource, /from ['"]\.\/execution\.js['"]/);
  assert.doesNotMatch(repositorySource, /\b(?:spawnSync|executionError|gitValue)\b/);
  assert.doesNotMatch(
    repositorySource,
    /from ['"][^'"]*(?:gates|integrations|orchestration|policies)\//,
  );
});

test('separates Git change collection facts from change classification policy', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'git-changes.js')), false);
  const collectionPath = path.join(
    SOURCE_ROOT,
    'git',
    'change-collection.js',
  );
  const classificationPath = path.join(
    SOURCE_ROOT,
    'policies',
    'change-classification.js',
  );
  assert.equal(existsSync(collectionPath), true);
  assert.equal(existsSync(classificationPath), true);

  const collectionSource = readFileSync(collectionPath, 'utf8');
  const classificationSource = readFileSync(classificationPath, 'utf8');
  assert.match(collectionSource, /export function parseNameStatus/);
  assert.match(collectionSource, /export function collectRevisionChanges/);
  assert.match(collectionSource, /export function collectStagedChanges/);
  assert.match(collectionSource, /export function collectWorkingTreeChanges/);
  assert.doesNotMatch(
    collectionSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration|policies)\//,
  );
  assert.match(classificationSource, /export function classifyChanges/);
  assert.match(classificationSource, /export function displayPath/);
  assert.doesNotMatch(
    classificationSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration)\//,
  );
});

test('keeps CI revision range ownership inside CI orchestration without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'ci-changes.js')), false);
  const ciRangePath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'ci',
    'change-range.js',
  );
  assert.equal(existsSync(ciRangePath), true);

  const ciRangeSource = readFileSync(ciRangePath, 'utf8');
  assert.match(ciRangeSource, /export function resolveCiRange/);
  assert.match(ciRangeSource, /CI_MERGE_REQUEST_DIFF_BASE_SHA/);
  assert.doesNotMatch(ciRangeSource, /\b(?:GateResult|finding|policy|registry)\b/i);
});

test('keeps managed commit-message summaries in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commit-message.js')), false);
  const summaryPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'commit-message-summary.js',
  );
  assert.equal(existsSync(summaryPolicyPath), true);

  const summaryPolicySource = readFileSync(summaryPolicyPath, 'utf8');
  assert.match(summaryPolicySource, /export function prepareCommitMessage/);
  assert.match(summaryPolicySource, /export function finalizeCommitMessage/);
  assert.match(summaryPolicySource, /export function cleanupCommitMessage/);
  assert.match(summaryPolicySource, /integrations\/git\/repository-state\.js/);
  assert.doesNotMatch(
    summaryPolicySource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('keeps structured exception validity and matching in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'exception-registry.js')), false);
  const exceptionRegistryPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'exception-registry.js',
  );
  assert.equal(existsSync(exceptionRegistryPolicyPath), true);

  const exceptionRegistryPolicySource = readFileSync(
    exceptionRegistryPolicyPath,
    'utf8',
  );
  assert.match(
    exceptionRegistryPolicySource,
    /export function inspectExceptionRegistry/,
  );
  assert.match(
    exceptionRegistryPolicySource,
    /export function assertExceptionRegistryCurrent/,
  );
  assert.match(
    exceptionRegistryPolicySource,
    /export function findStructuredException/,
  );
  assert.match(exceptionRegistryPolicySource, /configurationError/);
  assert.doesNotMatch(
    exceptionRegistryPolicySource,
    /from ['"][^'"]*(?:gates|integrations|orchestration)\//,
  );
});

test('keeps pre-push revision range ownership inside pre-push orchestration without a root compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'pre-push-changes.js')), false);
  const prePushRangePath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-push',
    'change-range.js',
  );
  assert.equal(existsSync(prePushRangePath), true);

  const prePushRangeSource = readFileSync(prePushRangePath, 'utf8');
  assert.match(prePushRangeSource, /export function parsePrePushUpdates/);
  assert.match(prePushRangeSource, /export function collectPrePushChanges/);
  assert.match(prePushRangeSource, /refs\/remotes\/\$\{remoteName\}\/HEAD/);
  assert.doesNotMatch(prePushRangeSource, /\b(?:GateResult|finding|policy|registry)\b/i);
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

test('keeps managed Hook installation in setup orchestration without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'hook-installer.js')), false);
  const installerPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'setup',
    'hook-installer.js',
  );
  assert.equal(existsSync(installerPath), true);

  const installerSource = readFileSync(installerPath, 'utf8');
  assert.match(installerSource, /export function installHooks/);
  assert.match(installerSource, /export function isManagedHook/);
  assert.match(installerSource, /export function isCurrentManagedHook/);
  assert.match(installerSource, /# repo-guard-managed:v4/);
  assert.match(installerSource, /# repo-guard-managed:v1/);
  assert.match(installerSource, /\.\/git-attributes\.js/);
  assert.match(installerSource, /\.\/lighthouse-ignore\.js/);
  assert.doesNotMatch(installerSource, /from ['"][^'"]*integrations\//);
});

test('keeps project configuration lifecycle in setup orchestration without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'config-management.js')), false);
  const configManagementPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'setup',
    'config-management.js',
  );
  assert.equal(existsSync(configManagementPath), true);

  const configManagementSource = readFileSync(configManagementPath, 'utf8');
  assert.match(configManagementSource, /writeFileSync/);
  assert.match(
    configManagementSource,
    /export function createStarterConfig/,
  );
  assert.match(
    configManagementSource,
    /export function migrateProjectConfig/,
  );
  assert.match(
    configManagementSource,
    /export function setFeaturesEnabled/,
  );
  assert.match(configManagementSource, /export function configureCi/);
  assert.doesNotMatch(configManagementSource, /from ['"][^'"]*commands\//);
});

test('keeps immutable platform defaults in the config module', () => {
  const defaultsPath = path.join(SOURCE_ROOT, 'config', 'defaults.js');
  assert.equal(existsSync(defaultsPath), true);

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const defaultsSource = readFileSync(defaultsPath, 'utf8');
  assert.match(configSource, /from ['"]\.\/config\/defaults\.js['"]/);
  assert.doesNotMatch(configSource, /^export const DEFAULT_/m);
  assert.match(defaultsSource, /export const DEFAULT_ARCHITECTURE_CONFIG/);
  assert.match(defaultsSource, /export const DEFAULT_UNIT_TEST_CONFIG/);
  assert.match(defaultsSource, /export const DEFAULT_FILE_PLACEMENT_CONFIG/);
  assert.match(defaultsSource, /Object\.freeze/);
  assert.doesNotMatch(defaultsSource, /^import /m);
});

test('keeps path normalization and rule matching in the config module', () => {
  const pathMatchingPath = path.join(SOURCE_ROOT, 'config', 'path-matching.js');
  assert.equal(existsSync(pathMatchingPath), true);

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const pathMatchingSource = readFileSync(pathMatchingPath, 'utf8');
  const publicEntrySource = readFileSync(path.join(SOURCE_ROOT, 'index.js'), 'utf8');
  const classificationSource = readFileSync(
    path.join(SOURCE_ROOT, 'policies', 'change-classification.js'),
    'utf8',
  );

  assert.match(configSource, /from ['"]\.\/config\/path-matching\.js['"]/);
  assert.doesNotMatch(configSource, /^export function (?:normalizeGitPath|globToRegExp|matchRule)/m);
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

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const primitivesSource = readFileSync(primitivesPath, 'utf8');
  const ciRunnerSource = readFileSync(
    path.join(SOURCE_ROOT, 'orchestration', 'ci', 'runner.js'),
    'utf8',
  );

  assert.match(configSource, /from ['"]\.\/config\/validation-primitives\.js['"]/);
  assert.doesNotMatch(configSource, /^function configValidationError/m);
  assert.doesNotMatch(configSource, /^export const CONFIG_FILE/m);
  assert.match(primitivesSource, /export const CONFIG_FILE/);
  assert.match(primitivesSource, /export function configValidationError/);
  assert.match(primitivesSource, /export function normalizeRelativePattern/);
  assert.match(primitivesSource, /export function validateCiReportPath/);
  assert.match(primitivesSource, /from ['"]\.\/path-matching\.js['"]/);
  assert.doesNotMatch(primitivesSource, /from ['"][^'"]*(?:policies|orchestration)\//);
  assert.match(ciRunnerSource, /from ['"]\.\.\/\.\.\/config\/validation-primitives\.js['"]/);
});

test('keeps CI and external gate validation in the config module', () => {
  const ciValidationPath = path.join(SOURCE_ROOT, 'config', 'ci-validation.js');
  assert.equal(existsSync(ciValidationPath), true);

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const ciValidationSource = readFileSync(ciValidationPath, 'utf8');

  assert.match(configSource, /from ['"]\.\/config\/ci-validation\.js['"]/);
  assert.match(configSource, /validateCiConfiguration\(value, configPath\)/);
  assert.doesNotMatch(configSource, /const externalGatesValue =/);
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

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const exceptionValidationSource = readFileSync(exceptionValidationPath, 'utf8');

  assert.match(configSource, /from ['"]\.\/config\/exception-validation\.js['"]/);
  assert.match(configSource, /validateExceptionConfiguration\(value, configPath\)/);
  assert.doesNotMatch(configSource, /const exceptionsValue =/);
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

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const dependencyPolicyValidationSource = readFileSync(
    dependencyPolicyValidationPath,
    'utf8',
  );

  assert.match(configSource, /from ['"]\.\/config\/dependency-policy-validation\.js['"]/);
  assert.match(
    configSource,
    /validateDependencyPolicyConfiguration\(value, configPath\)/,
  );
  assert.doesNotMatch(configSource, /const dependencyPolicyValue =/);
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

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const architectureValidationSource = readFileSync(
    architectureValidationPath,
    'utf8',
  );

  assert.match(configSource, /from ['"]\.\/config\/architecture-validation\.js['"]/);
  assert.match(configSource, /validateArchitectureConfiguration\(value, configPath\)/);
  assert.doesNotMatch(configSource, /const architectureValue =/);
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

  const configSource = readFileSync(path.join(SOURCE_ROOT, 'config.js'), 'utf8');
  const executionGateValidationSource = readFileSync(
    executionGateValidationPath,
    'utf8',
  );

  assert.match(configSource, /from ['"]\.\/config\/execution-gate-validation\.js['"]/);
  assert.match(configSource, /validateExecutionGateConfiguration\(/);
  assert.doesNotMatch(configSource, /const (?:build|lighthouse|typeCheck)Value =/);
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

test('keeps managed GitLab CI installation in setup orchestration without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'gitlab-ci.js')), false);
  const gitLabCiPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'setup',
    'gitlab-ci.js',
  );
  assert.equal(existsSync(gitLabCiPath), true);

  const gitLabCiSource = readFileSync(gitLabCiPath, 'utf8');
  assert.match(gitLabCiSource, /export function inspectGitLabCi/);
  assert.match(gitLabCiSource, /export function installGitLabCi/);
  assert.match(gitLabCiSource, /# repo-guard-gitlab-template:v1/);
  assert.match(gitLabCiSource, /# repo-guard-gitlab:start/);
  assert.match(gitLabCiSource, /# repo-guard-gitlab:end/);
  assert.doesNotMatch(gitLabCiSource, /from ['"][^'"]*integrations\//);
});

test('keeps local environment governance in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'local-env.js')), false);
  const localEnvironmentPath = path.join(
    SOURCE_ROOT,
    'policies',
    'local-environment.js',
  );
  assert.equal(existsSync(localEnvironmentPath), true);

  const localEnvironmentSource = readFileSync(localEnvironmentPath, 'utf8');
  assert.match(localEnvironmentSource, /export function loadLocalEnvironment/);
  assert.match(localEnvironmentSource, /export function resolveNotificationEnvironment/);
  assert.match(localEnvironmentSource, /export function ensureLocalEnvironment/);
  assert.match(localEnvironmentSource, /export function assertLocalEnvironmentNotStaged/);
  assert.match(localEnvironmentSource, /core\/policy\/managed-text-block\.js/);
  assert.doesNotMatch(
    localEnvironmentSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration)\//,
  );
});

test('keeps file placement rules and project scope in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'file-placement.js')), false);
  const filePlacementPath = path.join(
    SOURCE_ROOT,
    'policies',
    'file-placement.js',
  );
  assert.equal(existsSync(filePlacementPath), true);

  const filePlacementSource = readFileSync(filePlacementPath, 'utf8');
  assert.match(filePlacementSource, /export function inspectFilePlacement/);
  assert.match(filePlacementSource, /export function collectProjectFiles/);
  assert.match(filePlacementSource, /micromatch\.isMatch/);
  assert.match(filePlacementSource, /\['ls-files', '--cached', '--others'/);
  assert.doesNotMatch(
    filePlacementSource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('keeps maximum file line rules in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'max-file-lines.js')), false);
  const maxFileLinesPath = path.join(
    SOURCE_ROOT,
    'policies',
    'max-file-lines.js',
  );
  assert.equal(existsSync(maxFileLinesPath), true);

  const maxFileLinesSource = readFileSync(maxFileLinesPath, 'utf8');
  assert.match(maxFileLinesSource, /export function countPhysicalLines/);
  assert.match(maxFileLinesSource, /export function analyzeVueSections/);
  assert.match(maxFileLinesSource, /export function matchMaxFileLineRule/);
  assert.match(maxFileLinesSource, /export function selectMaxFileLineFiles/);
  assert.match(maxFileLinesSource, /export function evaluateMaxFileLines/);
  assert.match(maxFileLinesSource, /core\/execution\/staged-files\.js/);
  assert.doesNotMatch(
    maxFileLinesSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration)\//,
  );
});

test('keeps style scope governance in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'style-governance.js')), false);
  const styleGovernancePath = path.join(
    SOURCE_ROOT,
    'policies',
    'style-governance.js',
  );
  assert.equal(existsSync(styleGovernancePath), true);

  const styleGovernanceSource = readFileSync(styleGovernancePath, 'utf8');
  assert.match(
    styleGovernanceSource,
    /export function inspectUnexpectedGlobalStyles/,
  );
  assert.match(styleGovernanceSource, /no-unexpected-global-style/);
  assert.doesNotMatch(
    styleGovernanceSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration)\//,
  );
});

test('keeps Vue style language rules in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'vue-style-languages.js')), false);
  const styleLanguagesPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'vue-style-languages.js',
  );
  assert.equal(existsSync(styleLanguagesPolicyPath), true);

  const styleLanguagesPolicySource = readFileSync(
    styleLanguagesPolicyPath,
    'utf8',
  );
  assert.match(
    styleLanguagesPolicySource,
    /export function collectVueStyleLanguages/,
  );
  assert.match(
    styleLanguagesPolicySource,
    /export function assertVueStyleLanguages/,
  );
  assert.match(styleLanguagesPolicySource, /configurationError/);
  assert.doesNotMatch(
    styleLanguagesPolicySource,
    /from ['"][^'"]*(?:gates|integrations|orchestration)\//,
  );
});

test('keeps Vue target blank security rules in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'vue-target-blank.js')), false);
  const targetBlankPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'vue-target-blank.js',
  );
  assert.equal(existsSync(targetBlankPolicyPath), true);

  const targetBlankPolicySource = readFileSync(targetBlankPolicyPath, 'utf8');
  assert.match(targetBlankPolicySource, /integrations\/vue\/template-parser\.js/);
  assert.match(targetBlankPolicySource, /export const VUE_TARGET_BLANK_RULE/);
  assert.match(targetBlankPolicySource, /export function findVueTargetBlankIssues/);
  assert.match(targetBlankPolicySource, /export function inspectVueTargetBlank/);
  assert.match(targetBlankPolicySource, /findStructuredException/);
  assert.doesNotMatch(
    targetBlankPolicySource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('keeps Vue unsafe HTML security rules in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'vue-unsafe-html.js')), false);
  const unsafeHtmlPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'vue-unsafe-html.js',
  );
  assert.equal(existsSync(unsafeHtmlPolicyPath), true);

  const unsafeHtmlPolicySource = readFileSync(unsafeHtmlPolicyPath, 'utf8');
  assert.match(unsafeHtmlPolicySource, /integrations\/vue\/template-parser\.js/);
  assert.match(unsafeHtmlPolicySource, /export const VUE_NO_V_HTML_RULE/);
  assert.match(unsafeHtmlPolicySource, /export function findVueVHtml/);
  assert.match(unsafeHtmlPolicySource, /export function inspectUnsafeVueHtml/);
  assert.match(unsafeHtmlPolicySource, /findStructuredException/);
  assert.doesNotMatch(
    unsafeHtmlPolicySource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('keeps Vue form label rules in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'vue-form-label.js')), false);
  const formLabelPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'vue-form-label.js',
  );
  assert.equal(existsSync(formLabelPolicyPath), true);

  const formLabelPolicySource = readFileSync(formLabelPolicyPath, 'utf8');
  assert.match(formLabelPolicySource, /integrations\/vue\/template-parser\.js/);
  assert.match(formLabelPolicySource, /export function findVueFormLabelIssues/);
  assert.match(formLabelPolicySource, /export function inspectVueFormLabels/);
  assert.match(formLabelPolicySource, /findStructuredException/);
  assert.doesNotMatch(
    formLabelPolicySource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('keeps Vue image alt rules in policies without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'vue-image-alt.js')), false);
  const imageAltPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'vue-image-alt.js',
  );
  assert.equal(existsSync(imageAltPolicyPath), true);

  const imageAltPolicySource = readFileSync(imageAltPolicyPath, 'utf8');
  assert.match(imageAltPolicySource, /integrations\/vue\/template-parser\.js/);
  assert.match(imageAltPolicySource, /export function findVueImageAltIssues/);
  assert.match(imageAltPolicySource, /export function inspectVueImageAlts/);
  assert.match(imageAltPolicySource, /findStructuredException/);
  assert.doesNotMatch(
    imageAltPolicySource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('separates WeCom notification policy from network integration without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'wecom.js')), false);
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'wecom-notification.js');
  const integrationPath = path.join(
    SOURCE_ROOT,
    'integrations',
    'wecom',
    'notification.js',
  );
  assert.equal(existsSync(policyPath), true);
  assert.equal(existsSync(integrationPath), true);

  const policySource = readFileSync(policyPath, 'utf8');
  const integrationSource = readFileSync(integrationPath, 'utf8');
  assert.match(policySource, /export function loadNotificationConfig/);
  assert.match(policySource, /export function buildNotificationText/);
  assert.doesNotMatch(policySource, /node:https|sendWecomNotification/);
  assert.match(integrationSource, /from ['"]node:https['"]/);
  assert.match(integrationSource, /export function sendWecomNotification/);
  assert.doesNotMatch(integrationSource, /loadNotificationConfig|buildNotificationText/);
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

test('keeps Git attributes management in setup orchestration without a root helper', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'git-attributes.js')), false);
  const attributesPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'setup',
    'git-attributes.js',
  );
  assert.equal(existsSync(attributesPath), true);

  const attributesSource = readFileSync(attributesPath, 'utf8');
  assert.match(attributesSource, /export function ensureGitAttributes/);
  assert.match(attributesSource, /repo-guard-managed:attributes:start/);
  assert.doesNotMatch(
    attributesSource,
    /\b(?:GateResult|finding|registry|orchestratePlan|runGit)\b/i,
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

test('keeps the npm package surface limited to reviewed gate-platform artifacts', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.files, REVIEWED_PACKAGE_FILES);

  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => candidate && existsSync(candidate));
  assert.ok(npmCli);
  const packCache = mkdtempSync(path.join(tmpdir(), 'repo-guard-pack-cache-'));
  let packedRoots;
  try {
    const packResult = spawnSync(process.execPath, [
      npmCli,
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: packCache,
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(packResult.status, 0, packResult.stderr);
    const packReport = JSON.parse(packResult.stdout);
    assert.equal(packReport.length, 1);
    packedRoots = [...new Set(packReport[0].files.map(({ path: packedPath }) => (
      packedPath.replaceAll('\\', '/').split('/')[0]
    )))].sort();
  } finally {
    rmSync(packCache, { recursive: true, force: true });
  }
  assert.deepEqual(
    packedRoots,
    REVIEWED_PACKED_ROOTS,
  );

  const sourceEntries = readdirSync(SOURCE_ROOT, { withFileTypes: true });
  assert.deepEqual(
    sourceEntries.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort(),
    REVIEWED_SOURCE_DIRECTORIES,
  );
  assert.deepEqual(
    sourceEntries.filter((entry) => entry.isFile()).map(({ name }) => name).sort(),
    REVIEWED_SOURCE_FILES,
  );

  const automaticOrProductionScripts = Object.keys(packageJson.scripts)
    .filter((name) => /^(?:preinstall|install|postinstall|prepare|start|serve|deploy)(?::|$)/
      .test(name));
  assert.deepEqual(
    automaticOrProductionScripts,
    [],
  );
});

test('imports the public API without filesystem, process, or network side effects', () => {
  assertModuleImportIsInert(
    path.join(SOURCE_ROOT, 'index.js'),
    'repo-guard-public-import-',
    'Public API',
  );
});

test('keeps CLI execution behind the reviewed npm bin entrypoint', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.bin, { 'repo-guard': 'bin/repo-guard.js' });

  const launcherPath = path.join(ROOT, packageJson.bin['repo-guard']);
  const launcherSource = readFileSync(launcherPath, 'utf8').replaceAll('\r\n', '\n');
  assert.equal(launcherSource, REVIEWED_CLI_LAUNCHER);

  const unexpectedCallers = javascriptFiles(SOURCE_ROOT)
    .filter((file) => file !== path.join(SOURCE_ROOT, 'cli.js'))
    .filter((file) => /\brunCli\s*\(/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(unexpectedCallers, []);

  assertModuleImportIsInert(
    path.join(SOURCE_ROOT, 'cli.js'),
    'repo-guard-cli-import-',
    'CLI module',
    { allowModuleResolution: true },
  );
});
