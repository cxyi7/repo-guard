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
import { isRepoGuardError } from '../src/core/error/repo-guard-error.js';
import { runK6ExternalRunner } from '../src/gates/testing/k6-external-runner.js';
import { normalizeK6Summary } from '../src/integrations/k6/report.js';
import { runK6Runner } from '../src/orchestration/cli/k6-runner.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CONFIG_FILE = 'test/performance/k6-load.config.json';
const REPORT_FILE = 'reports/k6/k6-gate.json';
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function projectConfig(environments = ['manual']) {
  return {
    version: 1,
    notification: { enabled: false },
    externalGates: [{
      id: 'project.k6-load',
      enabled: true,
      environments,
      script: 'guard:k6',
      timeoutMs: 300000,
      report: { format: 'repo-guard-json-v1', path: REPORT_FILE },
    }],
    dependencyPolicy: { enabled: false },
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      maxFileLines: { enabled: false },
    },
    rules: [{ pattern: 'src/**', category: '源码', level: 'audit' }],
  };
}

function loadConfig({
  allowWrites = false,
  executor = 'ramping-vus',
  p95Ms = 500,
  errorRate = 0.01,
} = {}) {
  const profile = executor === 'ramping-vus'
    ? {
      name: 'smoke-read',
      executor,
      startVUs: 0,
      stages: [{ duration: '1s', target: 2 }],
      gracefulRampDown: '1s',
      gracefulStop: '1s',
    }
    : {
      name: 'steady-read',
      executor,
      rate: 5,
      timeUnit: '1s',
      duration: '1s',
      preAllocatedVUs: 1,
      maxVUs: 3,
      gracefulStop: '1s',
    };
  return {
    target: {
      baseUrlEnv: 'REPO_GUARD_TEST_K6_BASE_URL',
      allowedHosts: ['api-test.example.com'],
      confirmationEnv: 'REPO_GUARD_TEST_K6_CONFIRM',
      requireHttps: true,
    },
    script: 'test/performance/scenarios/read.k6.js',
    profile,
    thresholds: {
      p95Ms,
      p99Ms: 900,
      errorRate,
      checkRate: 0.99,
      maxDroppedIterations: 0,
    },
    environment: { pass: ['FAKE_K6_MODE'] },
    safety: { allowWrites },
  };
}

function confirmation(config) {
  const mode = config.safety.allowWrites ? 'writes' : 'readonly';
  if (config.profile.executor === 'ramping-vus') {
    const maxVUs = Math.max(config.profile.startVUs, ...config.profile.stages.map(({ target }) => target));
    return `api-test.example.com:${config.profile.name}:ramping-vus:${maxVUs}vus:1s:${mode}`;
  }
  return `api-test.example.com:${config.profile.name}:constant-arrival-rate:${config.profile.maxVUs}vus:${config.profile.rate}/${config.profile.timeUnit}:1s:${mode}`;
}

const READ_SCRIPT = `import http from 'k6/http';
import { check } from 'k6';

const baseURL = __ENV.REPO_GUARD_TEST_K6_BASE_URL;

export default function readScenario() {
  const response = http.get(\`${'${baseURL}'}/health\`);
  check(response, { '状态码为 200': (value) => value.status === 200 });
}
`;

const FAKE_K6 = `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'version') {
  process.stdout.write('k6 v1.7.1 (fake)\\n');
  process.exit(0);
}
if (args[0] === 'inspect') process.exit(0);
if (args[0] !== 'run') process.exit(23);
if (args.includes('--new-machine-readable-summary') || process.env.K6_NEW_MACHINE_READABLE_SUMMARY) {
  process.exit(109);
}
const mode = process.env.FAKE_K6_MODE;
const entry = args.at(-1);
const reportDirectory = path.dirname(path.resolve(process.cwd(), entry));
mkdirSync(reportDirectory, { recursive: true });
const controlledEntry = readFileSync(entry, 'utf8');
if (!controlledEntry.includes('http_req_duration{scenario:')) process.exit(108);
writeFileSync(path.join(reportDirectory, 'child-env.json'), JSON.stringify(process.env));
const violation = mode === 'violation';
const scenarioMetrics = (scenario) => ({
  [\`http_reqs{scenario:\${scenario}}\`]: { type: 'counter', values: { count: 100 } },
  [\`http_req_failed{scenario:\${scenario}}\`]: { type: 'rate', values: { rate: violation ? 0.2 : 0, passes: violation ? 20 : 0, fails: violation ? 80 : 100 } },
  [\`http_req_duration{scenario:\${scenario}}\`]: { type: 'trend', values: { avg: 100, min: 20, med: 80, max: violation ? 1200 : 450, 'p(90)': 180, 'p(95)': violation ? 700 : 200, 'p(99)': violation ? 1000 : 300 } },
  [\`iterations{scenario:\${scenario}}\`]: { type: 'counter', values: { count: 50 } },
  [\`dropped_iterations{scenario:\${scenario}}\`]: { type: 'counter', values: { count: 0 } },
  [\`checks{scenario:\${scenario}}\`]: { type: 'rate', values: { rate: violation ? 0.8 : 1, passes: violation ? 40 : 50, fails: violation ? 10 : 0 } }
});
const summary = {
  state: { testRunDurationMs: 10000 },
  metrics: {
    http_reqs: { type: 'counter', values: { count: 102 } },
    http_req_failed: { type: 'rate', values: { rate: 0.5, passes: 51, fails: 51 } },
    http_req_duration: { type: 'trend', values: { avg: 900, min: 20, med: 800, max: 3000, 'p(90)': 1200, 'p(95)': 1800, 'p(99)': 2500 } },
    iterations: { type: 'counter', values: { count: 52 } },
    dropped_iterations: { type: 'counter', values: { count: 9 } },
    ...scenarioMetrics('smoke-read'),
    ...scenarioMetrics('steady-read'),
    vus_max: { type: 'gauge', values: { max: 2, min: 0, value: 0 } }
  }
};
writeFileSync(path.join(reportDirectory, 'k6-summary.json'), JSON.stringify(summary));
if (mode === 'execution-error') process.exit(107);
process.exit(violation ? 99 : 0);
`;

function createFixture({
  environments = ['manual'],
  config = loadConfig(),
  script = READ_SCRIPT,
} = {}) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'k6-load-'));
  git(root, ['init']);
  mkdirSync(path.join(root, 'test', 'performance', 'scenarios'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'reports/\n');
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'k6-load-fixture',
    version: '1.0.0',
    scripts: { 'guard:k6': 'repo-guard k6-runner --gate-id project.k6-load --config test/performance/k6-load.config.json' },
  }, null, 2)}\n`);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(projectConfig(environments), null, 2)}\n`,
  );
  writeFileSync(path.join(root, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(path.join(root, 'test', 'performance', 'scenarios', 'read.k6.js'), script);
  const fakeK6 = path.join(root, 'fake-k6.mjs');
  writeFileSync(fakeK6, FAKE_K6);
  return { root, fakeK6, config };
}

function environment(config, mode = 'passed', extra = {}) {
  return {
    PATH: process.env.PATH,
    REPO_GUARD_TEST_K6_BASE_URL: 'https://api-test.example.com/v1/',
    REPO_GUARD_TEST_K6_CONFIRM: confirmation(config),
    FAKE_K6_MODE: mode,
    CI: 'false',
    GITLAB_CI: 'false',
    GITHUB_ACTIONS: 'false',
    ...extra,
  };
}

function runtime(fakeK6) {
  return { command: process.execPath, prefixArguments: [fakeK6] };
}

function executeFixture(fixture, overrides = {}) {
  return runK6ExternalRunner({
    root: fixture.root,
    gateId: 'project.k6-load',
    reportPath: REPORT_FILE,
    configFile: CONFIG_FILE,
    timeoutMs: 300000,
    environment: environment(fixture.config),
    runtime: runtime(fixture.fakeK6),
    ...overrides,
  });
}

test('runs a controlled local k6 process and writes raw, Chinese HTML, and gate reports', async (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const report = await executeFixture(fixture);

  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.httpRequests, 100);
  assert.equal(report.metrics.requestsPerSecond, 10);
  assert.deepEqual(report.artifacts.map(({ path: artifactPath }) => artifactPath), [
    'reports/k6/k6-summary.json',
    'reports/k6/k6-report.html',
  ]);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(fixture.root, REPORT_FILE), 'utf8')),
    report,
  );
  const html = readFileSync(path.join(fixture.root, 'reports', 'k6', 'k6-report.html'), 'utf8');
  assert.match(html, /k6 接口压测报告/);
  assert.match(html, /api-test\.example\.com/);
  assert.doesNotMatch(html, /REPO_GUARD_TEST_K6_BASE_URL/);
  assert.equal(existsSync(path.join(
    fixture.root,
    'reports',
    'k6',
    '.repo-guard-k6-entry.js',
  )), false);
});

test('maps threshold violations to the external-gate violation status and CLI exit code 2', async (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const exitCode = await runK6Runner({
    gateId: 'project.k6-load',
    configFile: CONFIG_FILE,
    cwd: fixture.root,
    environment: environment(fixture.config, 'violation'),
    runtime: runtime(fixture.fakeK6),
    streamOutput: false,
  });

  assert.equal(exitCode, 2);
  const report = JSON.parse(readFileSync(path.join(fixture.root, REPORT_FILE), 'utf8'));
  assert.equal(report.status, 'violation');
  assert.deepEqual(report.findings.map(({ ruleId }) => ruleId), [
    'k6-load/p95-exceeded',
    'k6-load/p99-exceeded',
    'k6-load/error-rate-exceeded',
    'k6-load/check-rate-below-threshold',
  ]);
});

test('treats non-threshold k6 exits as execution errors and does not persist a gate decision', async (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    executeFixture(fixture, {
      environment: environment(fixture.config, 'execution-error'),
    }),
    (error) => isRepoGuardError(error)
      && error.kind === 'execution'
      && error.code === 'k6-load/process-status-mismatch',
  );
  assert.equal(existsSync(path.join(fixture.root, REPORT_FILE)), false);
});

test('rejects automatic environments and non-manual external-gate configuration', async (context) => {
  const automated = createFixture();
  const nonManual = createFixture({ environments: ['ci-full'] });
  context.after(() => rmSync(automated.root, { recursive: true, force: true }));
  context.after(() => rmSync(nonManual.root, { recursive: true, force: true }));

  await assert.rejects(
    runK6Runner({
      gateId: 'project.k6-load',
      configFile: CONFIG_FILE,
      cwd: automated.root,
      environment: environment(automated.config, 'passed', { CI: 'true' }),
      runtime: runtime(automated.fakeK6),
      streamOutput: false,
    }),
    (error) => error.code === 'k6-load/automated-environment-rejected',
  );
  await assert.rejects(
    runK6Runner({
      gateId: 'project.k6-load',
      configFile: CONFIG_FILE,
      cwd: nonManual.root,
      environment: environment(nonManual.config),
      runtime: runtime(nonManual.fakeK6),
      streamOutput: false,
    }),
    (error) => error.code === 'k6-load/not-manual-only',
  );
});

test('requires an exact target, load profile, and write-mode confirmation', async (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    executeFixture(fixture, {
      environment: environment(fixture.config, 'passed', {
        REPO_GUARD_TEST_K6_CONFIRM: 'api-test.example.com',
      }),
    }),
    (error) => error.code === 'k6-load/load-not-confirmed',
  );
});

test('rejects runner-managed environment names and the reserved raw-summary report name', async (context) => {
  const reservedEnvironmentConfig = loadConfig();
  reservedEnvironmentConfig.environment.pass = ['K6_CLOUD_TOKEN'];
  const reservedEnvironment = createFixture({ config: reservedEnvironmentConfig });
  const reservedReport = createFixture();
  context.after(() => rmSync(reservedEnvironment.root, { recursive: true, force: true }));
  context.after(() => rmSync(reservedReport.root, { recursive: true, force: true }));

  await assert.rejects(
    executeFixture(reservedEnvironment, {
      environment: environment(reservedEnvironment.config, 'passed', {
        K6_CLOUD_TOKEN: 'not-allowed',
      }),
    }),
    (error) => error.code === 'k6-load/reserved-environment-name',
  );
  await assert.rejects(
    executeFixture(reservedReport, { reportPath: 'reports/k6/k6-summary.json' }),
    (error) => error.code === 'k6-load/reserved-primary-report-name',
  );
});

test('rejects protected exports, hard-coded URLs, and unapproved write requests', async (context) => {
  const scripts = [
    `${READ_SCRIPT}\nexport const options = {};\n`,
    READ_SCRIPT.replace('__ENV.REPO_GUARD_TEST_K6_BASE_URL', "'https://api-test.example.com'"),
    READ_SCRIPT.replace('http.get', 'http.post'),
  ];
  const fixtures = scripts.map((script) => createFixture({ script }));
  for (const fixture of fixtures) {
    context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  }

  await assert.rejects(executeFixture(fixtures[0]), (error) => error.code === 'k6-load/protected-export');
  await assert.rejects(executeFixture(fixtures[1]), (error) => error.code === 'k6-load/hardcoded-url');
  await assert.rejects(
    executeFixture(fixtures[2]),
    (error) => error.code === 'k6-load/write-request-not-authorized',
  );
});

test('rejects aliases and dynamic property access that could hide k6 HTTP write methods', async (context) => {
  const scripts = [
    READ_SCRIPT.replace(
      'export default function readScenario()',
      'const client = http;\n\nexport default function readScenario()',
    ).replace('http.get', 'client.get'),
    READ_SCRIPT.replace('http.get', "http['po' + 'st']"),
  ];
  const fixtures = scripts.map((script) => createFixture({ script }));
  for (const fixture of fixtures) {
    context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  }

  await assert.rejects(
    executeFixture(fixtures[0]),
    (error) => error.code === 'k6-load/dynamic-http-member',
  );
  await assert.rejects(
    executeFixture(fixtures[1]),
    (error) => error.code === 'k6-load/dynamic-http-member',
  );
});

test('requires every request URL to derive from the controlled base URL environment variable', async (context) => {
  const script = READ_SCRIPT.replace(
    '`${baseURL}/health`',
    "'https:' + '//' + 'other.example.com/health'",
  );
  const fixture = createFixture({ script });
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    executeFixture(fixture),
    (error) => error.code === 'k6-load/uncontrolled-request-url',
  );
});

test('requires run isolation and teardown for explicitly authorized write scenarios', async (context) => {
  const config = loadConfig({ allowWrites: true });
  const incomplete = createFixture({
    config,
    script: READ_SCRIPT.replace('http.get', 'http.post'),
  });
  context.after(() => rmSync(incomplete.root, { recursive: true, force: true }));

  await assert.rejects(
    executeFixture(incomplete),
    (error) => error.code === 'k6-load/incomplete-write-cleanup',
  );
});

test('rejects a nominal teardown that does not use runId in a direct cleanup request', async (context) => {
  const config = loadConfig({ allowWrites: true });
  const script = `${READ_SCRIPT.replace('http.get', 'http.post')}
const runId = __ENV.REPO_GUARD_K6_RUN_ID;
export function teardown() { void runId; }
`;
  const fixture = createFixture({ config, script });
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    executeFixture(fixture),
    (error) => error.code === 'k6-load/incomplete-write-cleanup',
  );
});

test('accepts an explicitly authorized write scenario with run isolation and teardown', async (context) => {
  const config = loadConfig({ allowWrites: true });
  const script = `import http from 'k6/http';
import { check } from 'k6';

const baseURL = __ENV.REPO_GUARD_TEST_K6_BASE_URL;
const runId = __ENV.REPO_GUARD_K6_RUN_ID;

export default function createScenario() {
  const response = http.post(\`${'${baseURL}'}/records\`, JSON.stringify({ runId }));
  check(response, { '创建成功': (value) => value.status === 201 });
}

export function teardown() {
  http.del(\`${'${baseURL}'}/records/by-run/\${runId}\`);
}
`;
  const fixture = createFixture({ config, script });
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const report = await executeFixture(fixture);

  assert.equal(report.status, 'passed');
});

test('supports controlled constant-arrival-rate profiles', async (context) => {
  const config = loadConfig({ executor: 'constant-arrival-rate' });
  const fixture = createFixture({ config });
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const report = await executeFixture(fixture);

  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.maximumVUs, 2);
});

test('passes only allowlisted project variables and repo-guard k6 controls to the child process', async (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  await executeFixture(fixture, {
    environment: environment(fixture.config, 'passed', {
      K6_CLOUD_TOKEN: 'must-not-leak',
      UNRELATED_SECRET: 'must-not-leak',
    }),
  });

  const child = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'k6', 'child-env.json'),
    'utf8',
  ));
  assert.equal(child.K6_CLOUD_TOKEN, undefined);
  assert.equal(child.UNRELATED_SECRET, undefined);
  assert.equal(child.FAKE_K6_MODE, 'passed');
  assert.equal(child.REPO_GUARD_TEST_K6_BASE_URL, 'https://api-test.example.com/v1/');
  assert.equal(child.K6_NO_USAGE_REPORT, 'true');
  assert.equal(child.K6_AUTO_EXTENSION_RESOLUTION, 'false');
  assert.equal(child.K6_NEW_MACHINE_READABLE_SUMMARY, undefined);
  assert.match(child.REPO_GUARD_K6_RUN_ID, /^[0-9a-f-]{36}$/);
});

test('normalizes the legacy k6 summary format for the supported compatibility window', () => {
  const metrics = normalizeK6Summary({
    state: { testRunDurationMs: 5000 },
    metrics: {
      http_reqs: { values: { count: 10, rate: 2 } },
      http_req_failed: { values: { rate: 0 } },
      http_req_duration: { values: { avg: 10, min: 1, med: 9, max: 20, 'p(90)': 15, 'p(95)': 17, 'p(99)': 19 } },
      iterations: { values: { count: 10 } },
      dropped_iterations: { values: { count: 0 } },
      vus_max: { values: { max: 2 } },
      checks: { values: { rate: 1, passes: 10, fails: 0 } },
    },
  });

  assert.equal(metrics.format, 'legacy');
  assert.equal(metrics.httpRequests, 10);
  assert.equal(metrics.checkRate, 1);
  assert.equal(metrics.requestsPerSecond, 2);
});

test('normalizes the official k6 machine-readable summary when no scenario filter is requested', () => {
  const metrics = normalizeK6Summary({
    version: '1.0.0',
    config: { duration: 5 },
    results: {
      metrics: [
        { name: 'http_reqs', values: { count: 10 } },
        { name: 'http_req_failed', values: { rate: 0, total: 10, matches: 0 } },
        { name: 'http_req_duration', values: { avg: 10, min: 1, med: 9, max: 20, 'p(90)': 15, 'p(95)': 17, 'p(99)': 19 } },
        { name: 'iterations', values: { count: 10 } },
        { name: 'dropped_iterations', values: { count: 0 } },
        { name: 'vus_max', values: { max: 2 } },
      ],
      checks: {
        metrics: [
          { name: 'checks_succeeded', values: { rate: 1, total: 10, matches: 10 } },
        ],
        results: [{ name: '状态码为 200', passes: 10, fails: 0 }],
      },
    },
  });

  assert.equal(metrics.format, 'machine-readable-v1');
  assert.equal(metrics.httpRequests, 10);
  assert.equal(metrics.checkRate, 1);
  assert.equal(metrics.requestsPerSecond, 2);
});

test('runs the opt-in real k6 integration against the official demo target', {
  skip: !process.env.REPO_GUARD_REAL_K6_BIN,
}, async (context) => {
  const config = {
    ...loadConfig(),
    target: {
      baseUrlEnv: 'REPO_GUARD_REAL_K6_BASE_URL',
      allowedHosts: ['test.k6.io'],
      confirmationEnv: 'REPO_GUARD_REAL_K6_CONFIRM',
      requireHttps: true,
    },
    profile: {
      name: 'official-demo-smoke',
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [{ duration: '1s', target: 1 }],
      gracefulRampDown: '1s',
      gracefulStop: '1s',
    },
    thresholds: {
      p95Ms: 10000,
      p99Ms: 15000,
      errorRate: 1,
      checkRate: 0,
      maxDroppedIterations: 10,
    },
    environment: { pass: [] },
  };
  const fixture = createFixture({
    config,
    script: READ_SCRIPT.replace(
      'REPO_GUARD_TEST_K6_BASE_URL',
      'REPO_GUARD_REAL_K6_BASE_URL',
    ),
  });
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const report = await executeFixture(fixture, {
    environment: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      REPO_GUARD_REAL_K6_BASE_URL: 'https://test.k6.io/',
      REPO_GUARD_REAL_K6_CONFIRM: 'test.k6.io:official-demo-smoke:ramping-vus:1vus:1s:readonly',
      CI: 'false',
      GITLAB_CI: 'false',
      GITHUB_ACTIONS: 'false',
    },
    runtime: { command: process.env.REPO_GUARD_REAL_K6_BIN, prefixArguments: [] },
    output: null,
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.maximumVUs, 1);
  assert.ok(report.metrics.httpRequests > 0);
  assert.ok(report.metrics.totalChecks > 0);
});
