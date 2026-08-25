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
const CLI_RUNNER_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'cli',
  'runner.js',
);
const DOCTOR_RUNNER_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'doctor',
  'runner.js',
);
const CLI_CHECK_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'cli',
  'check.js',
);
const CLI_GATE_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'cli',
  'gate.js',
);
const CLI_CONFIGURATION_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'cli',
  'configuration.js',
);
const CLI_INSTALL_CI_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'cli',
  'install-ci.js',
);
const CLI_INSTALL_HOOKS_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'cli',
  'install-hooks.js',
);
const PROJECT_INITIALIZATION_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'setup',
  'project-initialization.js',
);
const REPOSITORY_REPAIR_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'setup',
  'repository-repair.js',
);
const COMMIT_MESSAGE_RUNNER_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'commit-message',
  'runner.js',
);
const PRE_COMMIT_QUALITY_COMMAND_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'pre-commit',
  'quality-command.js',
);
const PRE_COMMIT_RUNNER_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'pre-commit',
  'runner.js',
);
const PRE_PUSH_CONFIGURATION_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'pre-push',
  'push-configuration.js',
);
const PRE_PUSH_RUNNER_PATH = path.join(
  SOURCE_ROOT,
  'orchestration',
  'pre-push',
  'runner.js',
);

const EXPECTED_BOUNDARY_RULES = Object.freeze([
  'config-does-not-depend-on-runtime-domains',
  'core-does-not-depend-on-platform-layers',
  'gate-domains-do-not-deep-import-each-other',
  'gates-do-not-depend-on-orchestration',
  'gates-do-not-import-report-renderers',
  'git-does-not-depend-on-policy-or-runtime-layers',
  'integrations-do-not-depend-on-policy-layers',
  'integrations-do-not-import-policy-or-rendering',
  'no-circular-dependencies',
  'no-unresolvable-imports',
  'orchestration-entrypoints-do-not-call-integrations-directly',
  'policies-do-not-depend-on-gates-or-orchestration',
]);

const REVIEWED_TOP_LEVEL_GATE_FILES = Object.freeze([
  'native-result.js',
  'platform-gate.js',
  'registry.js',
  'vue-policy-gate.js',
]);

const LEGACY_TOP_LEVEL_ARCHITECTURE_FILES = Object.freeze([]);

const REVIEWED_TOP_LEVEL_PROJECT_FILES = Object.freeze([]);

const REVIEWED_PACKAGE_FILES = Object.freeze([
  'bin',
  'docs',
  'scripts/check-syntax.js',
  'src',
  'config.schema.json',
  'external-report.schema.json',
  'api-performance-config.schema.json',
  'k6-load-config.schema.json',
  'gate-result.schema.json',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
]);

const REVIEWED_PACKED_ROOTS = Object.freeze([
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'api-performance-config.schema.json',
  'bin',
  'config.schema.json',
  'docs',
  'external-report.schema.json',
  'gate-result.schema.json',
  'k6-load-config.schema.json',
  'package.json',
  'scripts',
  'src',
]);

const REVIEWED_SOURCE_DIRECTORIES = Object.freeze([
  'config',
  'core',
  'gates',
  'git',
  'integrations',
  'orchestration',
  'policies',
]);

const REVIEWED_SOURCE_FILES = Object.freeze([
  'index.js',
]);

const REVIEWED_CLI_LAUNCHER = `#!/usr/bin/env node

import { runCli } from '../src/orchestration/cli/runner.js';

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
  const dependencyCruiserSource = readFileSync(
    path.join(ROOT, '.dependency-cruiser.cjs'),
    'utf8',
  );
  assert.doesNotMatch(dependencyCruiserSource, /commands\//);
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
      'src/policies/policy.js',
    ];
    for (const target of targets) writeFixture(fixtureRoot, target);

    writeFixture(fixtureRoot, 'src/core/invalid.js', "import '../gates/security/gate.js';\n");
    writeFixture(fixtureRoot, 'src/core/unresolved.js', "import './missing.js';\n");
    writeFixture(fixtureRoot, 'src/core/cycle-a.js', "import './cycle-b.js';\n");
    writeFixture(fixtureRoot, 'src/core/cycle-b.js', "import './cycle-a.js';\n");
    writeFixture(fixtureRoot, 'src/config/invalid.js', "import '../policies/policy.js';\n");
    writeFixture(fixtureRoot, 'src/git/invalid.js', "import '../integrations/npm/tool.js';\n");
    writeFixture(fixtureRoot, 'src/policies/invalid.js', "import '../orchestration/runner.js';\n");
    writeFixture(fixtureRoot, 'src/policies/integration-fact.js', "import '../integrations/npm/tool.js';\n");
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
    assert.equal(
      report.summary.violations.some(
        (violation) => violation.from === 'src/policies/integration-fact.js',
      ),
      false,
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

test('keeps the Node runtime contract in core project facts instead of doctor orchestration', () => {
  const nodeVersionPath = path.join(SOURCE_ROOT, 'core', 'project', 'node-version.js');
  assert.equal(existsSync(nodeVersionPath), true);

  const doctorSource = readFileSync(DOCTOR_RUNNER_PATH, 'utf8');
  const nodeVersionSource = readFileSync(nodeVersionPath, 'utf8');

  assert.match(doctorSource, /from ['"]\.\.\/\.\.\/core\/project\/node-version\.js['"]/);
  assert.doesNotMatch(doctorSource, /function parseNodeVersion|export const REQUIRED_NODE_RANGE/);
  assert.match(nodeVersionSource, /export const REQUIRED_NODE_RANGE/);
  assert.match(nodeVersionSource, /export function nodeVersionIsSupported/);
  assert.doesNotMatch(nodeVersionSource, /from ['"]/);
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
  assert.match(integrationSource, /export async function executeProjectBuild/);
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
  assert.match(integrationSource, /export async function executeProjectTypeCheck/);
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

test('separates Knip facts, debt policy, gate decisions, and baseline CLI routing', () => {
  const integrationRoot = path.join(SOURCE_ROOT, 'integrations', 'knip');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'dead-code-baseline.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'quality', 'dead-code-gate.js');
  const managementPath = path.join(
    SOURCE_ROOT,
    'gates',
    'quality',
    'dead-code-baseline-management.js',
  );
  const cliPath = path.join(SOURCE_ROOT, 'orchestration', 'cli', 'dead-code-baseline.js');
  for (const target of [
    path.join(integrationRoot, 'project.js'),
    path.join(integrationRoot, 'execution.js'),
    path.join(integrationRoot, 'report.js'),
    path.join(integrationRoot, 'configuration-hint-reporter.js'),
    policyPath,
    gatePath,
    managementPath,
    cliPath,
  ]) {
    assert.equal(existsSync(target), true);
  }
  const integrationSources = readdirSync(integrationRoot)
    .map((fileName) => readFileSync(path.join(integrationRoot, fileName), 'utf8'))
    .join('\n');
  assert.doesNotMatch(integrationSources, /(?:GateResult|dead-code-baseline\.js|console-renderer)/);
  assert.doesNotMatch(readFileSync(policyPath, 'utf8'), /integrations\/|gates\/|orchestration\//);
  assert.match(readFileSync(gatePath, 'utf8'), /integrations\/knip\/execution\.js/);
  assert.match(readFileSync(managementPath, 'utf8'), /policies\/dead-code-baseline\.js/);
  const cliSource = readFileSync(cliPath, 'utf8');
  assert.match(cliSource, /gates\/quality\/dead-code-baseline-management\.js/);
  assert.doesNotMatch(cliSource, /integrations\/knip\//);
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
  assert.match(integrationSource, /export async function executeAccessibilityTests/);
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
  assert.match(integrationSource, /export async function executeUnitTests/);
  assert.match(readFileSync(gatePath, 'utf8'), /integrations\/vitest\/execution\.js/);
  assert.match(readFileSync(setupPath, 'utf8'), /integrations\/vitest\/project\.js/);
  assert.doesNotMatch(readFileSync(policyPath, 'utf8'), /\bspawnSync\b/);
});

test('keeps native policy gates in their owning domains', () => {
  const legacyPath = path.join(SOURCE_ROOT, 'gates', 'repository', 'native-policy-gates.js');
  const helperPath = path.join(SOURCE_ROOT, 'gates', 'vue-policy-gate.js');
  const repositoryPath = path.join(
    SOURCE_ROOT,
    'gates',
    'repository',
    'repository-policy-gates.js',
  );
  const securityPath = path.join(SOURCE_ROOT, 'gates', 'security', 'vue-policy-gates.js');
  const accessibilityPath = path.join(
    SOURCE_ROOT,
    'gates',
    'accessibility',
    'vue-policy-gates.js',
  );
  assert.equal(existsSync(legacyPath), false);
  for (const target of [helperPath, repositoryPath, securityPath, accessibilityPath]) {
    assert.equal(existsSync(target), true);
  }

  const helperSource = readFileSync(helperPath, 'utf8');
  const repositorySource = readFileSync(repositoryPath, 'utf8');
  const securitySource = readFileSync(securityPath, 'utf8');
  const accessibilitySource = readFileSync(accessibilityPath, 'utf8');
  const registrySource = readFileSync(path.join(SOURCE_ROOT, 'gates', 'registry.js'), 'utf8');
  assert.match(helperSource, /export function defineVuePolicyGate/);
  assert.doesNotMatch(helperSource, /vue-(?:unsafe-html|target-blank|form-label|image-alt)/);
  assert.match(repositorySource, /export const repositoryPolicyGates/);
  assert.doesNotMatch(repositorySource, /security\.vue-|accessibility\.vue-/);
  assert.match(securitySource, /security\.vue-unsafe-html/);
  assert.match(securitySource, /security\.vue-target-blank/);
  assert.doesNotMatch(securitySource, /accessibility\.vue-/);
  assert.match(accessibilitySource, /accessibility\.vue-form-label/);
  assert.match(accessibilitySource, /accessibility\.vue-image-alt/);
  assert.doesNotMatch(accessibilitySource, /security\.vue-/);
  assert.match(registrySource, /\.\.\.vueSecurityGates,[\s\S]*\.\.\.vueAccessibilityGates,[\s\S]*\.\.\.repositoryPolicyGates/);
});

test('keeps platform gates in cohesive quality and testing modules', () => {
  const legacyPath = path.join(SOURCE_ROOT, 'gates', 'platform-capabilities.js');
  const helperPath = path.join(SOURCE_ROOT, 'gates', 'platform-gate.js');
  const stagedPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'staged-quality-gates.js');
  const projectPath = path.join(SOURCE_ROOT, 'gates', 'quality', 'project-quality-gates.js');
  const testingPath = path.join(SOURCE_ROOT, 'gates', 'testing', 'platform-test-gates.js');
  assert.equal(existsSync(legacyPath), false);
  for (const target of [helperPath, stagedPath, projectPath, testingPath]) {
    assert.equal(existsSync(target), true);
  }

  const helperSource = readFileSync(helperPath, 'utf8');
  const stagedSource = readFileSync(stagedPath, 'utf8');
  const projectSource = readFileSync(projectPath, 'utf8');
  const testingSource = readFileSync(testingPath, 'utf8');
  const registrySource = readFileSync(path.join(SOURCE_ROOT, 'gates', 'registry.js'), 'utf8');
  assert.match(helperSource, /export function definePlatformGate/);
  assert.doesNotMatch(helperSource, /quality\.(?:eslint|unit-test|build)/);
  assert.match(stagedSource, /export const stylelintGate/);
  assert.match(stagedSource, /export const eslintGate/);
  assert.match(stagedSource, /export const prettierGate/);
  assert.match(projectSource, /export const typecheckGate/);
  assert.match(projectSource, /export const architectureGate/);
  assert.match(projectSource, /export const deadCodeGate/);
  assert.match(projectSource, /export const buildGate/);
  assert.match(projectSource, /export const lighthouseGate/);
  assert.match(testingSource, /export const unitTestGate/);
  assert.match(testingSource, /export const accessibilityTestGate/);
  assert.match(
    registrySource,
    /stylelintGate,[\s\S]*eslintGate,[\s\S]*prettierGate,[\s\S]*typecheckGate,[\s\S]*unitTestGate,[\s\S]*accessibilityTestGate,[\s\S]*architectureGate,[\s\S]*buildGate,[\s\S]*lighthouseGate,[\s\S]*styleComplexityGate,[\s\S]*styleGovernanceGate/,
  );
});

test('keeps staged fingerprints in the unified Git domain without a compatibility path', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'fingerprint.js')), false);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'integrations', 'git')), false);
  const fingerprintPath = path.join(
    SOURCE_ROOT,
    'git',
    'staged-fingerprint.js',
  );
  assert.equal(existsSync(fingerprintPath), true);

  const fingerprintSource = readFileSync(fingerprintPath, 'utf8');
  assert.match(fingerprintSource, /export function createStagedFingerprint/);
  assert.match(fingerprintSource, /\['write-tree'\]/);
  assert.match(fingerprintSource, /from ['"]\.\/execution\.js['"]/);
  assert.doesNotMatch(fingerprintSource, /\b(?:GateResult|finding|policy|registry)\b/i);
  assert.doesNotMatch(
    fingerprintSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration|policies)\//,
  );
});

test('keeps repository-local state persistence in the unified Git domain', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'state.js')), false);
  const statePath = path.join(
    SOURCE_ROOT,
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
  assert.match(stateSource, /from ['"]\.\/repository\.js['"]/);
  assert.doesNotMatch(stateSource, /\b(?:GateResult|finding|policy|registry)\b/i);
  assert.doesNotMatch(
    stateSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration|policies)\//,
  );
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
  assert.match(summaryPolicySource, /\.\.\/git\/repository-state\.js/);
  assert.doesNotMatch(
    summaryPolicySource,
    /from ['"][^'"]*(?:gates|orchestration)\//,
  );
});

test('keeps commit-message Hook lifecycle in orchestration without a command facade', () => {
  assert.equal(existsSync(COMMIT_MESSAGE_RUNNER_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'hook-message.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const commitMessageRunnerSource = readFileSync(COMMIT_MESSAGE_RUNNER_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\.\/commit-message\/runner\.js['"]/);
  assert.match(commitMessageRunnerSource, /export function runHookMessage/);
  assert.match(
    commitMessageRunnerSource,
    /from ['"]\.\.\/\.\.\/policies\/commit-message-summary\.js['"]/,
  );
  assert.doesNotMatch(commitMessageRunnerSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('separates commit-message configuration, Git facts, policy, result adaptation, and Hook orchestration', () => {
  const validationPath = path.join(SOURCE_ROOT, 'config', 'commit-message-validation.js');
  const factsPath = path.join(SOURCE_ROOT, 'git', 'commit-messages.js');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'commit-message.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'repository', 'commit-message-gate.js');
  assert.equal(existsSync(validationPath), true);
  assert.equal(existsSync(factsPath), true);
  assert.equal(existsSync(policyPath), true);
  assert.equal(existsSync(gatePath), true);

  const validationSource = readFileSync(validationPath, 'utf8');
  const factsSource = readFileSync(factsPath, 'utf8');
  const policySource = readFileSync(policyPath, 'utf8');
  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(validationSource, /export function validateCommitMessageConfiguration/);
  assert.doesNotMatch(validationSource, /from ['"][^'"]*(?:git|gates|orchestration|policies)\//);
  assert.match(factsSource, /export function collectCommitMessages/);
  assert.doesNotMatch(factsSource, /from ['"][^'"]*(?:gates|orchestration|policies)\//);
  assert.match(policySource, /export function inspectCommitMessage/);
  assert.doesNotMatch(policySource, /from ['"][^'"]*(?:gates|git|orchestration)\//);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/git\/commit-messages\.js['"]/);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/policies\/commit-message\.js['"]/);
  assert.doesNotMatch(gateSource, /from ['"][^'"]*(?:orchestration|report)\//);
});

test('separates structured exception lifecycle from policy matching', () => {
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'exception-registry.js')), false);
  const exceptionLifecyclePath = path.join(
    SOURCE_ROOT,
    'config',
    'exception-lifecycle.js',
  );
  const exceptionRegistryPolicyPath = path.join(
    SOURCE_ROOT,
    'policies',
    'exception-registry.js',
  );
  assert.equal(existsSync(exceptionLifecyclePath), true);
  assert.equal(existsSync(exceptionRegistryPolicyPath), true);

  const exceptionLifecycleSource = readFileSync(exceptionLifecyclePath, 'utf8');
  const exceptionRegistryPolicySource = readFileSync(
    exceptionRegistryPolicyPath,
    'utf8',
  );
  assert.match(
    exceptionLifecycleSource,
    /export function inspectExceptionLifecycle/,
  );
  assert.match(
    exceptionLifecycleSource,
    /export function assertExceptionLifecycleCurrent/,
  );
  assert.match(exceptionLifecycleSource, /configurationError/);
  assert.doesNotMatch(
    exceptionLifecycleSource,
    /from ['"][^'"]*(?:gates|integrations|orchestration|policies)\//,
  );
  assert.match(
    exceptionRegistryPolicySource,
    /export function findStructuredException/,
  );
  assert.match(
    exceptionRegistryPolicySource,
    /from ['"]\.\.\/config\/exception-lifecycle\.js['"]/,
  );
  assert.doesNotMatch(exceptionRegistryPolicySource, /configurationError/);
  assert.doesNotMatch(exceptionRegistryPolicySource, /export function inspectException/);
  assert.doesNotMatch(exceptionRegistryPolicySource, /export function assertException/);
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

  const metadataSource = `${readFileSync(npmPath, 'utf8')}\n${readFileSync(gitPath, 'utf8')}`;
  assert.doesNotMatch(
    metadataSource,
    /\b(?:findStructuredException|inspectDeclarations|compareLockfile|remediation)\b/,
  );
  assert.match(metadataSource, /export function readStagedPackageMetadata/);
  assert.match(metadataSource, /export function readPackageMetadataFile/);
  assert.match(readFileSync(gitPath, 'utf8'), /from ['"]\.\/execution\.js['"]/);
  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(gateSource, /\.\.\/\.\.\/git\/staged-package-metadata\.js/);
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
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'ci.js')), false);
  const commandPath = path.join(SOURCE_ROOT, 'orchestration', 'ci', 'command.js');
  const runnerPath = path.join(SOURCE_ROOT, 'orchestration', 'ci', 'runner.js');
  const reportPath = path.join(SOURCE_ROOT, 'orchestration', 'ci', 'report.js');
  assert.equal(existsSync(commandPath), true);
  assert.equal(existsSync(runnerPath), true);
  assert.equal(existsSync(reportPath), true);

  const commandSource = readFileSync(commandPath, 'utf8');
  const runnerSource = readFileSync(runnerPath, 'utf8');
  const reportSource = readFileSync(reportPath, 'utf8');
  assert.match(commandSource, /export async function runCiCommand/);
  assert.match(commandSource, /from ['"]\.\/runner\.js['"]/);
  assert.match(commandSource, /from ['"]\.\/report\.js['"]/);
  assert.doesNotMatch(commandSource, /from ['"][^'"]*commands\//);
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
  assert.match(gitLabCiSource, /# repo-guard-gitlab-template:v2/);
  assert.doesNotMatch(gitLabCiSource, /# repo-guard-gitlab-template:v1/);
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

test('separates path naming configuration, Git facts, policy decisions, and GateResult adaptation', () => {
  const configPath = path.join(SOURCE_ROOT, 'config', 'path-naming-validation.js');
  const gitFactsPath = path.join(SOURCE_ROOT, 'git', 'tracked-paths.js');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'path-naming.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'repository', 'path-naming-gate.js');

  for (const expectedPath of [configPath, gitFactsPath, policyPath, gatePath]) {
    assert.equal(existsSync(expectedPath), true);
  }

  const configSource = readFileSync(configPath, 'utf8');
  const gitFactsSource = readFileSync(gitFactsPath, 'utf8');
  const policySource = readFileSync(policyPath, 'utf8');
  const gateSource = readFileSync(gatePath, 'utf8');

  assert.match(configSource, /export function validatePathNamingConfiguration/);
  assert.doesNotMatch(configSource, /from ['"][^'"]*(?:git|policies|gates|orchestration)\//);
  assert.match(gitFactsSource, /export function collectTrackedProjectPaths/);
  assert.match(gitFactsSource, /\['ls-files', '--cached', '-z'\]/);
  assert.doesNotMatch(gitFactsSource, /micromatch|GateResult|finding|policy/i);
  assert.match(policySource, /export function inspectPathNaming/);
  assert.doesNotMatch(policySource, /from ['"][^'"]*(?:git|gates|orchestration)\//);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/git\/tracked-paths\.js['"]/);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/policies\/path-naming\.js['"]/);
  assert.doesNotMatch(gateSource, /from ['"][^'"]*orchestration\//);
});

test('separates image configuration, binary facts, tool integration, policy, gate, and CLI routing', () => {
  const configPath = path.join(SOURCE_ROOT, 'config', 'image-assets-validation.js');
  const gitFactsPath = path.join(SOURCE_ROOT, 'git', 'binary-content.js');
  const integrationPath = path.join(SOURCE_ROOT, 'integrations', 'images', 'optimization.js');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'image-assets.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'repository', 'image-assets-gate.js');
  const cliPath = path.join(SOURCE_ROOT, 'orchestration', 'cli', 'image-optimize.js');

  for (const expectedPath of [
    configPath,
    gitFactsPath,
    integrationPath,
    policyPath,
    gatePath,
    cliPath,
  ]) {
    assert.equal(existsSync(expectedPath), true);
  }

  const configSource = readFileSync(configPath, 'utf8');
  const gitFactsSource = readFileSync(gitFactsPath, 'utf8');
  const integrationSource = readFileSync(integrationPath, 'utf8');
  const policySource = readFileSync(policyPath, 'utf8');
  const gateSource = readFileSync(gatePath, 'utf8');
  const cliSource = readFileSync(cliPath, 'utf8');

  assert.match(configSource, /export function validateImageAssetsConfiguration/);
  assert.doesNotMatch(configSource, /from ['"][^'"]*(?:git|policies|gates|integrations|orchestration)\//);
  assert.match(gitFactsSource, /export function readGitBlob/);
  assert.doesNotMatch(gitFactsSource, /micromatch|GateResult|finding|policy/i);
  assert.match(integrationSource, /export async function createWebpCandidate/);
  assert.doesNotMatch(integrationSource, /from ['"][^'"]*(?:policies|gates|orchestration)\//);
  assert.match(policySource, /export function inspectDuplicateGroups/);
  assert.doesNotMatch(policySource, /from ['"][^'"]*(?:git|gates|integrations|orchestration)\//);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/git\/binary-content\.js['"]/);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/integrations\/images\/optimization\.js['"]/);
  assert.match(cliSource, /from ['"]\.\.\/\.\.\/gates\/repository\/image-assets-optimizer\.js['"]/);
  assert.doesNotMatch(cliSource, /from ['"][^'"]*integrations\//);
});

test('separates code placement content facts, policy decisions, and GateResult adaptation', () => {
  const configPath = path.join(SOURCE_ROOT, 'config', 'code-placement-validation.js');
  const indexFactsPath = path.join(SOURCE_ROOT, 'git', 'index-content.js');
  const projectFactsPath = path.join(SOURCE_ROOT, 'core', 'project', 'text-files.js');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'code-placement.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'repository', 'code-placement-gate.js');

  for (const expectedPath of [
    configPath,
    indexFactsPath,
    projectFactsPath,
    policyPath,
    gatePath,
  ]) {
    assert.equal(existsSync(expectedPath), true);
  }

  const configSource = readFileSync(configPath, 'utf8');
  const indexFactsSource = readFileSync(indexFactsPath, 'utf8');
  const projectFactsSource = readFileSync(projectFactsPath, 'utf8');
  const policySource = readFileSync(policyPath, 'utf8');
  const gateSource = readFileSync(gatePath, 'utf8');

  assert.match(configSource, /export function validateCodePlacementConfiguration/);
  assert.doesNotMatch(configSource, /from ['"][^'"]*(?:git|policies|gates|orchestration)\//);
  assert.match(indexFactsSource, /export function readIndexTextFiles/);
  assert.doesNotMatch(indexFactsSource, /micromatch|GateResult|finding|policy/i);
  assert.match(projectFactsSource, /export function readProjectTextFiles/);
  assert.doesNotMatch(projectFactsSource, /micromatch|GateResult|finding|policy/i);
  assert.match(policySource, /export function inspectCodePlacement/);
  assert.match(policySource, /export function selectCodePlacementFiles/);
  assert.doesNotMatch(policySource, /from ['"][^'"]*(?:git|gates|orchestration)\//);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/git\/index-content\.js['"]/);
  assert.match(gateSource, /from ['"]\.\.\/\.\.\/policies\/code-placement\.js['"]/);
  assert.doesNotMatch(gateSource, /from ['"][^'"]*orchestration\//);
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
  assert.match(styleGovernanceSource, /function governanceViolation/);
  assert.match(styleGovernanceSource, /function inspectVueStyleViolations/);
  assert.match(styleGovernanceSource, /no-unexpected-global-style/);
  assert.doesNotMatch(styleGovernanceSource, /\b(?:warning|warnings|vueWarnings)\b/);
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

test('separates GitLab notification policy, release delivery, package facts, and CLI wiring', () => {
  const packageFactPath = path.join(
    SOURCE_ROOT,
    'core',
    'project',
    'repo-guard-package.js',
  );
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'gitlab-ci-notification.js');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'release', 'gitlab-ci-notification.js');
  const pipelinePath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'setup',
    'gitlab-managed-pipeline.js',
  );
  for (const target of [packageFactPath, policyPath, gatePath, pipelinePath]) {
    assert.equal(existsSync(target), true, target);
  }

  const packageFactSource = readFileSync(packageFactPath, 'utf8');
  const policySource = readFileSync(policyPath, 'utf8');
  const gateSource = readFileSync(gatePath, 'utf8');
  const pipelineSource = readFileSync(pipelinePath, 'utf8');
  const cliSource = readFileSync(CLI_RUNNER_PATH, 'utf8');

  assert.match(packageFactSource, /export function repoGuardPackageVersion/);
  assert.doesNotMatch(packageFactSource, /(?:gates|integrations|orchestration|policies)\//);
  assert.match(policySource, /export function buildGitLabCiNotificationText/);
  assert.doesNotMatch(policySource, /from ['"][^'"]*(?:gates|integrations|orchestration)\//);
  assert.match(gateSource, /integrations\/wecom\/notification\.js/);
  assert.match(gateSource, /policies\/gitlab-ci-notification\.js/);
  assert.doesNotMatch(gateSource, /orchestration\//);
  assert.match(pipelineSource, /core\/project\/repo-guard-package\.js/);
  assert.doesNotMatch(pipelineSource, /integrations\/wecom|sendWecomNotification/);
  assert.match(cliSource, /gates\/release\/gitlab-ci-notification\.js/);
  assert.doesNotMatch(cliSource, /integrations\/wecom|sendWecomNotification/);
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
    './api-performance-config.schema.json': './api-performance-config.schema.json',
    './k6-load-config.schema.json': './k6-load-config.schema.json',
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

test('keeps CLI argument parsing in CLI orchestration', () => {
  const argumentParsingPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'cli',
    'argument-parsing.js',
  );
  assert.equal(existsSync(argumentParsingPath), true);

  const cliSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const argumentParsingSource = readFileSync(argumentParsingPath, 'utf8');

  assert.match(
    cliSource,
    /from ['"]\.\/argument-parsing\.js['"]/,
  );
  assert.doesNotMatch(cliSource, /^function ensureSupportedOptions/m);
  assert.doesNotMatch(cliSource, /^function parseValuedOptions/m);
  assert.match(argumentParsingSource, /export function ensureSupportedOptions/);
  assert.match(argumentParsingSource, /export function parseValuedOptions/);
  assert.match(
    argumentParsingSource,
    /from ['"]\.\.\/\.\.\/core\/error\/repo-guard-error\.js['"]/,
  );
  assert.doesNotMatch(
    argumentParsingSource,
    /from ['"][^'"]*(?:commands|gates|integrations|policies)\//,
  );
  assert.doesNotMatch(argumentParsingSource, /(?:node:fs|process\.|readFileSync)/);
});

test('keeps protected working tree checks in CLI orchestration without a command facade', () => {
  assert.equal(existsSync(CLI_CHECK_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'check.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const cliCheckSource = readFileSync(CLI_CHECK_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\/check\.js['"]/);
  assert.match(cliCheckSource, /export function runCheck/);
  assert.match(cliCheckSource, /collectWorkingTreeChanges/);
  assert.match(cliCheckSource, /writeGateResultConsole/);
  assert.doesNotMatch(cliCheckSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps the manual protected-file gate in CLI orchestration without a command facade', () => {
  assert.equal(existsSync(CLI_GATE_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'gate.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const cliGateSource = readFileSync(CLI_GATE_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\/gate\.js['"]/);
  assert.match(cliGateSource, /export async function runGate/);
  assert.match(cliGateSource, /id: ['"]manual:protected-files['"]/);
  assert.match(cliGateSource, /from ['"]\.\.\/orchestrator\.js['"]/);
  assert.doesNotMatch(cliGateSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps configuration lifecycle commands in CLI orchestration without a command facade', () => {
  assert.equal(existsSync(CLI_CONFIGURATION_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'configure.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const cliConfigurationSource = readFileSync(CLI_CONFIGURATION_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\/configuration\.js['"]/);
  assert.match(cliConfigurationSource, /export function runMigrate/);
  assert.match(cliConfigurationSource, /export function runEnable/);
  assert.match(cliConfigurationSource, /export function runDisable/);
  assert.match(cliConfigurationSource, /from ['"]\.\.\/setup\/config-management\.js['"]/);
  assert.match(cliConfigurationSource, /from ['"]\.\.\/\.\.\/policies\/agent-policies\.js['"]/);
  assert.doesNotMatch(cliConfigurationSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps managed CI installation commands in CLI orchestration without a command facade', () => {
  assert.equal(existsSync(CLI_INSTALL_CI_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'install-ci.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const cliInstallCiSource = readFileSync(CLI_INSTALL_CI_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\/install-ci\.js['"]/);
  assert.match(cliInstallCiSource, /export function runInstallCiCommand/);
  assert.match(cliInstallCiSource, /from ['"]\.\.\/setup\/gitlab-ci\.js['"]/);
  assert.doesNotMatch(cliInstallCiSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps managed Hook installation CLI adaptation separate from project initialization', () => {
  assert.equal(existsSync(CLI_INSTALL_HOOKS_PATH), true);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const installHooksSource = readFileSync(CLI_INSTALL_HOOKS_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\/install-hooks\.js['"]/);
  assert.match(installHooksSource, /export function runInstallHooks/);
  assert.match(installHooksSource, /from ['"]\.\.\/setup\/hook-installer\.js['"]/);
  assert.doesNotMatch(installHooksSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps project initialization in setup orchestration without a command facade', () => {
  assert.equal(existsSync(PROJECT_INITIALIZATION_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'init.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const initializationSource = readFileSync(PROJECT_INITIALIZATION_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\.\/setup\/project-initialization\.js['"]/);
  assert.match(initializationSource, /export function runInit/);
  assert.match(initializationSource, /from ['"]\.\/config-management\.js['"]/);
  assert.match(initializationSource, /from ['"]\.\/hook-installer\.js['"]/);
  assert.doesNotMatch(initializationSource, /runInstallHooks|allowMissingGit/);
  assert.doesNotMatch(initializationSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps doctor repository mutation in setup orchestration separate from diagnosis', () => {
  assert.equal(existsSync(REPOSITORY_REPAIR_PATH), true);

  const doctorSource = readFileSync(DOCTOR_RUNNER_PATH, 'utf8');
  const repairSource = readFileSync(REPOSITORY_REPAIR_PATH, 'utf8');

  assert.match(doctorSource, /from ['"]\.\.\/setup\/repository-repair\.js['"]/);
  assert.doesNotMatch(doctorSource, /function repairRepository|ensureProjectConfig|migrateProjectConfig/);
  assert.match(repairSource, /export function repairRepository/);
  assert.match(repairSource, /from ['"]\.\/config-management\.js['"]/);
  assert.match(repairSource, /from ['"]\.\/hook-installer\.js['"]/);
  assert.doesNotMatch(repairSource, /createProjectGateRegistry|writeConsoleMessage/);
});

test('keeps doctor diagnosis in orchestration and the transition command layer empty', () => {
  assert.equal(existsSync(DOCTOR_RUNNER_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'doctor.js')), false);

  const commandsPath = path.join(SOURCE_ROOT, 'commands');
  const commandEntries = existsSync(commandsPath)
    ? readdirSync(commandsPath, { withFileTypes: true }).filter((entry) => entry.isFile())
    : [];
  assert.deepEqual(commandEntries, []);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const doctorSource = readFileSync(DOCTOR_RUNNER_PATH, 'utf8');
  assert.match(cliRunnerSource, /from ['"]\.\.\/doctor\/runner\.js['"]/);
  assert.match(doctorSource, /export async function runDoctor/);
  assert.match(doctorSource, /from ['"]\.\.\/setup\/repository-repair\.js['"]/);
  assert.doesNotMatch(doctorSource, /from ['"][^'"]*commands\//);
});

test('keeps staged quality CLI adaptation separate from pre-commit lifecycle orchestration', () => {
  assert.equal(existsSync(PRE_COMMIT_QUALITY_COMMAND_PATH), true);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const qualityCommandSource = readFileSync(PRE_COMMIT_QUALITY_COMMAND_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\.\/pre-commit\/quality-command\.js['"]/);
  assert.match(qualityCommandSource, /export async function runQualityFileCommand/);
  assert.match(qualityCommandSource, /from ['"]\.\/quality-runner\.js['"]/);
  assert.doesNotMatch(qualityCommandSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps pre-commit lifecycle orchestration in its domain without a command facade', () => {
  assert.equal(PRE_COMMIT_RUNNER_PATH.endsWith(path.join('pre-commit', 'runner.js')), true);
  assert.equal(existsSync(PRE_COMMIT_RUNNER_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'pre-commit.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const preCommitRunnerSource = readFileSync(PRE_COMMIT_RUNNER_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\.\/pre-commit\/runner\.js['"]/);
  assert.match(preCommitRunnerSource, /export async function runPreCommit/);
  assert.match(preCommitRunnerSource, /from ['"]\.\/lint-staged-gate\.js['"]/);
  assert.match(preCommitRunnerSource, /from ['"]\.\/protected-plan\.js['"]/);
  assert.doesNotMatch(preCommitRunnerSource, /quality-command\.js|quality-runner\.js/);
  assert.doesNotMatch(preCommitRunnerSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps pushed configuration and exact snapshot resolution separate from pre-push execution', () => {
  assert.equal(existsSync(PRE_PUSH_CONFIGURATION_PATH), true);

  const prePushSource = readFileSync(PRE_PUSH_RUNNER_PATH, 'utf8');
  const configurationSource = readFileSync(PRE_PUSH_CONFIGURATION_PATH, 'utf8');

  assert.match(prePushSource, /from ['"]\.\/push-configuration\.js['"]/);
  assert.doesNotMatch(prePushSource, /function (?:loadConfigAtRevision|assertExactPushSnapshot|resolvePushConfig)/);
  assert.match(configurationSource, /export function resolvePushConfig/);
  assert.match(configurationSource, /from ['"]\.\/change-range\.js['"]/);
  assert.match(configurationSource, /pre-push\/snapshot-mismatch/);
  assert.doesNotMatch(configurationSource, /orchestratePlan|writeGateResultConsole/);
});

test('keeps pre-push lifecycle orchestration in its domain without a command facade', () => {
  assert.equal(existsSync(PRE_PUSH_RUNNER_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'commands', 'pre-push.js')), false);

  const cliRunnerSource = readFileSync(CLI_RUNNER_PATH, 'utf8');
  const prePushRunnerSource = readFileSync(PRE_PUSH_RUNNER_PATH, 'utf8');

  assert.match(cliRunnerSource, /from ['"]\.\.\/pre-push\/runner\.js['"]/);
  assert.match(prePushRunnerSource, /export async function runPrePush/);
  assert.match(prePushRunnerSource, /from ['"]\.\/change-range\.js['"]/);
  assert.match(prePushRunnerSource, /from ['"]\.\/push-configuration\.js['"]/);
  assert.doesNotMatch(prePushRunnerSource, /from ['"]\.\.\/\.\.\/commands\//);
});

test('keeps CLI execution in CLI orchestration behind the reviewed npm bin entrypoint', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.bin, { 'repo-guard': 'bin/repo-guard.js' });
  assert.equal(existsSync(CLI_RUNNER_PATH), true);
  assert.equal(existsSync(path.join(SOURCE_ROOT, 'cli.js')), false);

  const launcherPath = path.join(ROOT, packageJson.bin['repo-guard']);
  const launcherSource = readFileSync(launcherPath, 'utf8').replaceAll('\r\n', '\n');
  assert.equal(launcherSource, REVIEWED_CLI_LAUNCHER);

  const unexpectedCallers = javascriptFiles(SOURCE_ROOT)
    .filter((file) => file !== CLI_RUNNER_PATH)
    .filter((file) => /\brunCli\s*\(/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(unexpectedCallers, []);

  assertModuleImportIsInert(
    CLI_RUNNER_PATH,
    'repo-guard-cli-import-',
    'CLI module',
    { allowModuleResolution: true },
  );
});

test('enforces Chinese user-facing text as a non-growing repository contract', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const agentsSource = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const checkerSource = readFileSync(
    path.join(ROOT, 'scripts', 'check-user-facing-language.js'),
    'utf8',
  );
  const prunerSource = readFileSync(
    path.join(ROOT, 'scripts', 'prune-user-facing-language-baseline.js'),
    'utf8',
  );
  const baseline = JSON.parse(readFileSync(
    path.join(ROOT, 'scripts', 'user-facing-language-baseline.json'),
    'utf8',
  ));

  assert.match(packageJson.scripts.check, /node scripts\/check-user-facing-language\.js/);
  assert.equal(
    packageJson.scripts['language:prune-baseline'],
    'node scripts/prune-user-facing-language-baseline.js',
  );
  assert.match(agentsSource, /user-facing statuses, warnings, errors/);
  assert.match(agentsSource, /migration baseline may only shrink/);
  assert.match(checkerSource, /compareLanguageDebt/);
  assert.doesNotMatch(checkerSource, /writeFileSync|write-initial-baseline/);
  assert.match(prunerSource, /pruneLanguageDebtBaseline/);
  assert.doesNotMatch(prunerSource, /createLanguageDebtBaseline/);
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(baseline.debtCount, 0);
});

test('separates Git file-header facts, pure policy, and pre-commit mutation ownership', () => {
  const validationPath = path.join(SOURCE_ROOT, 'config', 'file-header-validation.js');
  const gitHistoryPath = path.join(SOURCE_ROOT, 'git', 'file-history.js');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'file-header.js');
  const normalizerPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'file-header-normalizer.js',
  );
  const qualityRunnerPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'quality-runner.js',
  );
  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const gitHistorySource = readFileSync(gitHistoryPath, 'utf8');
  const policySource = readFileSync(policyPath, 'utf8');
  const normalizerSource = readFileSync(normalizerPath, 'utf8');
  const qualityRunnerSource = readFileSync(qualityRunnerPath, 'utf8');

  for (const file of [validationPath, gitHistoryPath, policyPath, normalizerPath]) {
    assert.equal(existsSync(file), true);
  }
  assert.match(preCommitValidationSource, /validateFileHeaderConfiguration/);
  assert.doesNotMatch(gitHistorySource, /policies|orchestration/);
  assert.doesNotMatch(policySource, /node:fs|git\//);
  assert.match(normalizerSource, /from ['"]\.\.\/\.\.\/git\/file-history\.js['"]/);
  assert.match(normalizerSource, /from ['"]\.\.\/\.\.\/policies\/file-header\.js['"]/);
  assert.match(qualityRunnerSource, /synchronizeStagedFileHeaders/);
  assert.match(qualityRunnerSource, /plan: preCommitQualityPlan/);
});

test('separates function-documentation validation, policy, and staged mutation ownership', () => {
  const validationPath = path.join(SOURCE_ROOT, 'config', 'function-doc-validation.js');
  const policyPath = path.join(SOURCE_ROOT, 'policies', 'function-documentation.js');
  const normalizerPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'function-documentation-normalizer.js',
  );
  const qualityRunnerPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'pre-commit',
    'quality-runner.js',
  );
  const preCommitValidationSource = readFileSync(
    path.join(SOURCE_ROOT, 'config', 'pre-commit-validation.js'),
    'utf8',
  );
  const policySource = readFileSync(policyPath, 'utf8');
  const normalizerSource = readFileSync(normalizerPath, 'utf8');
  const qualityRunnerSource = readFileSync(qualityRunnerPath, 'utf8');

  for (const file of [validationPath, policyPath, normalizerPath]) {
    assert.equal(existsSync(file), true);
  }
  assert.match(preCommitValidationSource, /validateFunctionDocConfiguration/);
  assert.doesNotMatch(policySource, /node:fs|git\/|orchestration\//);
  assert.match(
    normalizerSource,
    /from ['"]\.\.\/\.\.\/policies\/function-documentation\.js['"]/,
  );
  assert.match(qualityRunnerSource, /synchronizeStagedFunctionDocumentation/);
  assert.match(qualityRunnerSource, /selectFunctionDocumentationFiles/);
});

test('keeps Axios performance execution behind a manual-only external runner', () => {
  const integrationRoot = path.join(SOURCE_ROOT, 'integrations', 'api-performance');
  const gatePath = path.join(
    SOURCE_ROOT,
    'gates',
    'testing',
    'api-performance-external-runner.js',
  );
  const commandPath = path.join(
    SOURCE_ROOT,
    'orchestration',
    'cli',
    'api-performance-runner.js',
  );
  const registrySource = readFileSync(path.join(SOURCE_ROOT, 'gates', 'registry.js'), 'utf8');
  const plansSource = readFileSync(
    path.join(SOURCE_ROOT, 'orchestration', 'execution-plans.js'),
    'utf8',
  );
  const gateSource = readFileSync(gatePath, 'utf8');
  const commandSource = readFileSync(commandPath, 'utf8');

  for (const file of ['configuration.js', 'execution.js', 'project.js', 'report.js']) {
    assert.equal(existsSync(path.join(integrationRoot, file)), true);
  }
  assert.match(gateSource, /integrations\/api-performance/);
  assert.match(commandSource, /gates\/testing\/api-performance-external-runner\.js/);
  assert.doesNotMatch(commandSource, /integrations\/api-performance/);
  assert.match(commandSource, /gate\.environments\.length !== 1/);
  assert.match(commandSource, /AUTOMATION_ENVIRONMENT_MARKERS/);
  assert.doesNotMatch(registrySource, /api-performance/);
  assert.doesNotMatch(plansSource, /api-performance/);
});

test('keeps k6 load execution behind a manual-only external runner', () => {
  const integrationRoot = path.join(SOURCE_ROOT, 'integrations', 'k6');
  const gatePath = path.join(SOURCE_ROOT, 'gates', 'testing', 'k6-external-runner.js');
  const commandPath = path.join(SOURCE_ROOT, 'orchestration', 'cli', 'k6-runner.js');
  const registrySource = readFileSync(path.join(SOURCE_ROOT, 'gates', 'registry.js'), 'utf8');
  const plansSource = readFileSync(
    path.join(SOURCE_ROOT, 'orchestration', 'execution-plans.js'),
    'utf8',
  );
  const gateSource = readFileSync(gatePath, 'utf8');
  const commandSource = readFileSync(commandPath, 'utf8');

  for (const file of [
    'configuration.js',
    'execution.js',
    'project.js',
    'report.js',
    'script-validation.js',
  ]) {
    assert.equal(existsSync(path.join(integrationRoot, file)), true);
  }
  assert.match(gateSource, /integrations\/k6/);
  assert.match(commandSource, /gates\/testing\/k6-external-runner\.js/);
  assert.doesNotMatch(commandSource, /integrations\/k6/);
  assert.match(commandSource, /gate\.environments\.length !== 1/);
  assert.match(commandSource, /AUTOMATION_ENVIRONMENT_MARKERS/);
  assert.doesNotMatch(registrySource, /k6-load/);
  assert.doesNotMatch(plansSource, /k6-load/);
});
