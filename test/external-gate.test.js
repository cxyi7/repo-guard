import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateConfig } from '../src/config.js';
import { runCiGate } from '../src/orchestration/ci/runner.js';
import { createProjectGateRegistry } from '../src/gates/registry.js';
import { createProjectCiFullPlan } from '../src/orchestration/execution-plans.js';
import { runExternalManualGate } from '../src/orchestration/cli/manual-gates.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = path.join(process.cwd(), 'bin', 'repo-guard.js');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function externalConfig(extra = {}) {
  return {
    id: 'project.api-contract',
    enabled: true,
    environments: ['manual', 'ci-full'],
    script: 'test:external',
    timeoutMs: 30000,
    report: { format: 'repo-guard-json-v1', path: 'reports/external.json' },
    ...extra,
  };
}

function projectConfig(externalGates) {
  return {
    version: 1,
    notification: { enabled: false },
    externalGates,
    dependencyPolicy: { enabled: false },
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      maxFileLines: { enabled: false },
    },
    rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
  };
}

function createFixture({
  report,
  exitCode = 0,
  config = externalConfig(),
  output = null,
  trackReport = false,
}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'external-gate-'));
  git(root, ['init']);
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(
    path.join(root, 'scripts', 'external.mjs'),
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('reports', { recursive: true });",
      `writeFileSync('reports/external.json', ${JSON.stringify(`${JSON.stringify(report)}\n`)});`,
      ...(output == null ? [] : [`console.log(${JSON.stringify(output)});`]),
      `process.exitCode = ${exitCode};`,
    ].join('\n'),
  );
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'external-fixture',
    version: '1.0.0',
    scripts: { 'test:external': 'node scripts/external.mjs' },
  }, null, 2)}\n`);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(projectConfig([config]), null, 2)}\n`,
  );
  if (trackReport) {
    const trackedPath = process.platform === 'win32'
      ? 'reports/EXTERNAL.json'
      : 'reports/external.json';
    mkdirSync(path.join(root, 'reports'));
    writeFileSync(path.join(root, trackedPath), `${JSON.stringify(passedReport())}\n`);
    git(root, ['add', trackedPath]);
  }
  return root;
}

function passedReport(extra = {}) {
  return {
    schemaVersion: 1,
    gateId: 'project.api-contract',
    status: 'passed',
    summary: 'API contract checks passed',
    findings: [],
    metrics: { requests: 3 },
    artifacts: [],
    ...extra,
  };
}

test('appends enabled external gates only to the fixed end of CI full', () => {
  const config = validateConfig(projectConfig([
    externalConfig(),
    externalConfig({ id: 'project.disabled', enabled: false, report: { format: 'repo-guard-json-v1', path: 'reports/disabled.json' } }),
    externalConfig({ id: 'project.manual-only', environments: ['manual'], report: { format: 'repo-guard-json-v1', path: 'reports/manual.json' } }),
  ]));
  const registry = createProjectGateRegistry(config);
  const plan = createProjectCiFullPlan(config, registry);
  assert.equal(plan.steps.at(-1).id, 'project.api-contract');
  assert.equal(plan.steps.some(({ id }) => id === 'project.disabled'), false);
  assert.equal(plan.steps.some(({ id }) => id === 'project.manual-only'), false);
  const untrustedPlan = createProjectCiFullPlan(config, registry, { includeExternalGates: false });
  assert.equal(untrustedPlan.steps.some(({ id }) => id.startsWith('project.')), false);
});

test('runs a project npm script and returns its native structured result', async (context) => {
  const root = createFixture({ report: passedReport(), output: 'api_key=do-not-leak' });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await runExternalManualGate('project.api-contract', root);
  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.requests, 3);
  assert.equal(result.artifacts[0].path, 'reports/external.json');
  assert.match(result.diagnostics[0].message, /api_key=\[REDACTED\]/);
  assert.doesNotMatch(result.diagnostics[0].message, /do-not-leak/);
});

test('exposes only the explicit external CLI entry for project gate ids', (context) => {
  const root = createFixture({ report: passedReport() });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [CLI_PATH, 'external', 'project.api-contract'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS {2}project\.api-contract/);

  const rejected = spawnSync(process.execPath, [CLI_PATH, 'external', 'quality.build'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /not an external project gate/);
});

test('runs enabled external gates at the end of CI full and records native JSON', async (context) => {
  const root = createFixture({ report: passedReport() });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const base = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'next.js'), 'export const next = true;\n');
  git(root, ['add', 'src/next.js']);
  git(root, ['commit', '-m', 'next']);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const config = validateConfig({
    ...projectConfig([externalConfig({ environments: ['ci-full'] })]),
    ci: {
      enabled: true,
      profile: 'full',
      reportPath: 'reports/ci.json',
      protectedFiles: { action: 'report' },
    },
  });
  assert.equal(await runCiGate({
    root,
    config,
    base,
    head,
    env: { GITLAB_CI: 'true', CI_COMMIT_REF_PROTECTED: 'true' },
  }), 0);
  const report = JSON.parse(readFileSync(path.join(root, 'reports', 'ci.json'), 'utf8'));
  assert.equal(report.steps.at(-1).name, 'project.api-contract');
  assert.equal(report.steps.at(-1).gateResult.status, 'passed');

  assert.equal(await runCiGate({
    root,
    config,
    base,
    head,
    reportPath: 'reports/untrusted-ci.json',
    env: { GITLAB_CI: 'true', CI_COMMIT_REF_PROTECTED: 'false' },
  }), 0);
  const untrustedReport = JSON.parse(readFileSync(path.join(root, 'reports', 'untrusted-ci.json'), 'utf8'));
  assert.equal(untrustedReport.steps.some(({ name }) => name.startsWith('project.')), false);
});

test('requires violation reports to use exit code 2 and include an error finding', async (context) => {
  const root = createFixture({
    report: passedReport({
      status: 'violation',
      summary: 'Contract drift found',
      findings: [{ ruleId: 'api/contract-drift', severity: 'error', message: 'Response changed' }],
    }),
    exitCode: 2,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await runExternalManualGate('project.api-contract', root);
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'api/contract-drift');
});

test('rejects contradictory, unknown, sensitive, and stale report behavior', async (context) => {
  const fixtures = [
    { report: passedReport(), exitCode: 2, pattern: /requires script exit code 0/ },
    { report: passedReport({ unexpected: true }), exitCode: 0, pattern: /unknown field/ },
    { report: passedReport({ summary: 'token=super-secret' }), exitCode: 0, pattern: /contains sensitive data/ },
    {
      report: passedReport({
        artifacts: [{ path: 'reports\\nested\\result.txt', type: 'text' }],
      }),
      exitCode: 0,
      pattern: /normalized path/,
    },
    {
      report: passedReport({
        findings: [{
          ruleId: 'api/path',
          severity: 'warning',
          message: 'Bad path',
          location: { path: 'src\\api.js' },
        }],
      }),
      exitCode: 0,
      pattern: /normalized repository-relative path/,
    },
    {
      report: passedReport({ artifacts: [{ path: 'reports/result.txt:secret', type: 'text' }] }),
      exitCode: 0,
      pattern: /normalized path/,
    },
    {
      report: passedReport({ artifacts: [{ path: 'reports/result.', type: 'text' }] }),
      exitCode: 0,
      pattern: /normalized path/,
    },
  ];
  for (const fixture of fixtures) {
    const root = createFixture(fixture);
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const result = await runExternalManualGate('project.api-contract', root);
    assert.equal(result.status, 'execution-error');
    assert.match(result.summary, fixture.pattern);
  }

  const missingRoot = createFixture({ report: passedReport() });
  context.after(() => rmSync(missingRoot, { recursive: true, force: true }));
  writeFileSync(path.join(missingRoot, 'scripts', 'external.mjs'), 'process.exitCode = 0;\n');
  mkdirSync(path.join(missingRoot, 'reports'));
  writeFileSync(path.join(missingRoot, 'reports', 'external.json'), `${JSON.stringify(passedReport())}\n`);
  const missing = await runExternalManualGate('project.api-contract', missingRoot);
  assert.equal(missing.status, 'execution-error');
  assert.match(missing.summary, /did not generate/);
  assert.equal(readFileSync(path.join(missingRoot, 'scripts', 'external.mjs'), 'utf8'), 'process.exitCode = 0;\n');

  const trackedRoot = createFixture({ report: passedReport(), trackReport: true });
  context.after(() => rmSync(trackedRoot, { recursive: true, force: true }));
  const tracked = await runExternalManualGate('project.api-contract', trackedRoot);
  assert.equal(tracked.status, 'execution-error');
  assert.equal(tracked.error.kind, 'security');
  assert.equal(tracked.error.code, 'external-gate/tracked-file-overwrite');
  assert.match(tracked.summary, /must not overwrite a tracked file/);
});

test('terminates the complete npm process tree when an external gate times out', async (context) => {
  const root = createFixture({
    report: passedReport(),
    config: externalConfig({ timeoutMs: 1000 }),
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, 'scripts', 'external.mjs'),
    [
      "import { spawn } from 'node:child_process';",
      "import { mkdirSync } from 'node:fs';",
      "mkdirSync('reports', { recursive: true });",
      "spawn(process.execPath, ['-e', \"setTimeout(() => require('node:fs').writeFileSync('reports/orphan.txt', 'orphan'), 1500)\"], { stdio: 'ignore' });",
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );
  const result = await runExternalManualGate('project.api-contract', root);
  assert.equal(result.status, 'execution-error');
  assert.match(result.summary, /exceeded its 1000ms timeout/);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(existsSync(path.join(root, 'reports', 'orphan.txt')), false);
});
