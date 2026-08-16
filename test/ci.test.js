import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveCiRange } from '../src/orchestration/ci/change-range.js';
import { runCiGate } from '../src/orchestration/ci/runner.js';
import { validateConfig } from '../src/config/configuration-validation.js';
import { runCiCommand } from '../src/orchestration/ci/command.js';
import { runDoctor } from '../src/orchestration/doctor/runner.js';
import { ensureExceptionPolicy } from '../src/policies/managed-policies.js';
import {
  GITLAB_TEMPLATE_FILE,
  inspectGitLabCi,
  installGitLabCi,
} from '../src/orchestration/setup/gitlab-ci.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function config(extra = {}) {
  return validateConfig({
    version: 1,
    notification: { enabled: false },
    ci: {
      enabled: true,
      profile: 'policy',
      reportPath: 'reports/repo-guard.json',
      protectedFiles: { action: 'report' },
    },
    dependencyPolicy: { enabled: false, requireLockfile: false },
    preCommit: {
      filePlacement: { enabled: false },
      maxFileLines: { enabled: false },
      eslint: { enabled: false },
      prettier: { enabled: false },
      stylelint: { enabled: false },
    },
    rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
    ...extra,
  });
}

function sparseCiConfig() {
  return {
    version: 1,
    dependencyPolicy: { enabled: false },
    preCommit: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      maxFileLines: { enabled: false },
    },
    rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
  };
}

function repository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'ci-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'safe.js'), 'export const safe = true;\n');
  writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"fixture","version":"1.0.0","devDependencies":{"@cxyi7/repo-guard":"0.15.0"}}\n',
  );
  writeFileSync(
    path.join(root, 'package-lock.json'),
    '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'src', 'next.js'), 'export const next = true;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'next']);
  return { root, base, head: git(root, ['rev-parse', 'HEAD']) };
}

test('resolves explicit and GitLab CI change ranges without requiring a clean checkout', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(path.join(fixture.root, 'local.txt'), 'untracked');

  const explicit = resolveCiRange(fixture.root, { base: fixture.base, head: fixture.head });
  assert.equal(explicit.base, fixture.base);
  assert.equal(explicit.head, fixture.head);
  assert.deepEqual(explicit.changes.map(({ path: file }) => file), ['src/next.js']);

  const gitlab = resolveCiRange(fixture.root, {
    env: {
      GITLAB_CI: 'true',
      CI_MERGE_REQUEST_DIFF_BASE_SHA: fixture.base,
      CI_COMMIT_SHA: fixture.head,
    },
  });
  assert.equal(gitlab.base, fixture.base);
  assert.throws(
    () => resolveCiRange(fixture.root, {
      env: { GITLAB_CI: 'true', CI_COMMIT_SHA: fixture.head },
    }),
    /CI 基准版本不可用/,
  );
});

test('runs a read-only policy profile and always writes structured JSON', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const before = readFileSync(path.join(fixture.root, 'src', 'next.js'), 'utf8');

  assert.equal(await runCiGate({
    root: fixture.root,
    config: config(),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 0);
  const report = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  ));
  assert.equal(report.status, 'passed');
  assert.equal(report.profile, 'policy');
  assert.equal(report.protectedFiles.length, 1);
  assert.deepEqual(report.steps.map(({ name, status }) => ({ name, status })), [
    { name: 'repository.structured-exceptions', status: 'passed' },
    { name: 'dynamic-code', status: 'passed' },
    { name: 'security.vue-unsafe-html', status: 'passed' },
    { name: 'security.vue-target-blank', status: 'passed' },
    { name: 'accessibility.vue-form-label', status: 'passed' },
    { name: 'accessibility.vue-image-alt', status: 'passed' },
    { name: 'dependencies.policy', status: 'skipped' },
    { name: 'repository.file-placement', status: 'skipped' },
    { name: 'repository.maximum-file-lines', status: 'skipped' },
    { name: 'unit-test-policy', status: 'skipped' },
    { name: 'protected-files', status: 'passed' },
  ]);
  assert.equal(report.steps.every((step) => !('diagnostics' in step)), true);
  const dynamicCodeStep = report.steps.find(({ name }) => name === 'dynamic-code');
  assert.equal(dynamicCodeStep.exitCode, 0);
  assert.deepEqual(dynamicCodeStep.gateResult, {
    schemaVersion: 2,
    gateId: 'security.dynamic-code',
    status: 'passed',
    summary: dynamicCodeStep.gateResult.summary,
    findings: [],
    issues: [],
    metrics: {
      checkedFiles: 2,
      approvedExceptions: 0,
      violations: 0,
    },
    artifacts: [],
    diagnostics: dynamicCodeStep.gateResult.diagnostics,
    durationMs: dynamicCodeStep.gateResult.durationMs,
  });
  assert.equal(readFileSync(path.join(fixture.root, 'src', 'next.js'), 'utf8'), before);

  assert.equal(await runCiGate({
    root: fixture.root,
    config: config({
      ci: {
        enabled: true,
        profile: 'policy',
        reportPath: 'reports/failed.json',
        protectedFiles: { action: 'fail' },
      },
    }),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 2);
  assert.equal(JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'failed.json'),
    'utf8',
  )).status, 'failed');
});

test('writes native dynamic-code findings with the unified CI exit contract', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'src', 'unsafe.js'),
    'export const unsafe = (payload) => eval(payload);\n',
  );

  assert.equal(await runCiGate({
    root: fixture.root,
    config: config(),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 2);
  const report = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  ));
  const step = report.steps.find(({ name }) => name === 'dynamic-code');
  assert.deepEqual({ status: step.status, exitCode: step.exitCode }, {
    status: 'failed',
    exitCode: 2,
  });
  assert.equal(step.gateResult.status, 'violation');
  assert.equal(step.gateResult.findings[0].ruleId, 'security/no-eval');
  assert.deepEqual(step.gateResult.metrics, {
    checkedFiles: 3,
    approvedExceptions: 0,
    violations: 1,
  });
});

test('keeps dynamic-code execution errors distinct from policy violations', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(path.join(fixture.root, 'src', 'invalid.js'), 'const = ;\n');

  assert.equal(await runCiGate({
    root: fixture.root,
    config: config(),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 1);
  const report = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  ));
  const step = report.steps.find(({ name }) => name === 'dynamic-code');
  assert.equal(step.status, 'error');
  assert.equal(step.exitCode, 1);
  assert.equal(step.gateResult.status, 'execution-error');
  assert.match(step.gateResult.error.message, /动态代码门禁无法解析/);
});

test('installs a managed GitLab include and preserves existing pipeline jobs', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const rootCi = 'stages:\n  - verify\n\nexisting_job:\n  stage: verify\n  script:\n    - echo existing\n';
  writeFileSync(path.join(fixture.root, '.gitlab-ci.yml'), rootCi);
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify(sparseCiConfig(), null, 2)}\n`,
  );

  const result = installGitLabCi(fixture.root, { profile: 'policy' });
  assert.equal(result.integrated, true);
  const installedRoot = readFileSync(path.join(fixture.root, '.gitlab-ci.yml'), 'utf8');
  assert.match(installedRoot, /existing_job:/);
  assert.match(installedRoot, /local: \/\.gitlab\/ci\/repo-guard\.yml/);
  assert.match(installedRoot, /extends: \.repo_guard_policy/);
  assert.match(installedRoot, /stage: verify/);
  const template = readFileSync(path.join(fixture.root, GITLAB_TEMPLATE_FILE), 'utf8');
  assert.match(template, /repo-guard-gitlab-template:v1/);
  assert.match(template, /npx --no-install repo-guard ci --profile policy/);
  assert.match(template, /npx --no-install repo-guard ci --profile release-ready/);
  assert.match(template, /node:22\.23\.2/);
  assert.match(template, /GIT_DEPTH: "0"/);
  assert.match(template, /REPO_GUARD_SKIP_HOOKS: "1"/);
  assert.match(template, /- reports\//);
  const installedConfig = validateConfig(JSON.parse(readFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    'utf8',
  )));
  assert.deepEqual(inspectGitLabCi(
    fixture.root,
    installedConfig,
  ).problems, []);
  ensureExceptionPolicy(fixture.root, installedConfig.exceptions);
  assert.equal(await runDoctor(fixture.root, { ci: true }), 0);

  const repeat = installGitLabCi(fixture.root, { profile: 'policy' });
  assert.equal(repeat.rootChanged, false);
  assert.equal(repeat.templateChanged, false);
  assert.equal(installedRoot, readFileSync(path.join(fixture.root, '.gitlab-ci.yml'), 'utf8'));
});

test('installs the release-ready GitLab profile without embedding publish or deploy', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify(sparseCiConfig(), null, 2)}\n`,
  );
  const installed = installGitLabCi(fixture.root, { profile: 'release-ready' });
  assert.equal(installed.integrated, true);
  const root = readFileSync(path.join(fixture.root, '.gitlab-ci.yml'), 'utf8');
  const template = readFileSync(path.join(fixture.root, GITLAB_TEMPLATE_FILE), 'utf8');
  assert.match(root, /extends: \.repo_guard_release_ready/);
  assert.match(template, /repo-guard ci --profile release-ready/);
  assert.doesNotMatch(template, /npm publish|\bdeploy\b/);
  const installedConfig = validateConfig(JSON.parse(readFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    'utf8',
  )));
  assert.equal(installedConfig.ci.profile, 'release-ready');
  assert.deepEqual(inspectGitLabCi(fixture.root, installedConfig).problems, []);
});

test('generates the GitLab template but does not rewrite complex existing includes', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const original = 'include:\n  - project: group/shared\n    file: /base.yml\n';
  writeFileSync(path.join(fixture.root, '.gitlab-ci.yml'), original);
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify(sparseCiConfig(), null, 2)}\n`,
  );

  const result = installGitLabCi(fixture.root, { profile: 'full' });
  assert.equal(result.integrated, false);
  assert.match(result.conflict, /已定义 include/);
  assert.equal(readFileSync(path.join(fixture.root, '.gitlab-ci.yml'), 'utf8'), original);
  assert.equal(existsSync(path.join(fixture.root, GITLAB_TEMPLATE_FILE)), true);
});

test('exposes install-ci and ci through the package CLI', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify(sparseCiConfig(), null, 2)}\n`,
  );
  const cli = path.join(process.cwd(), 'bin', 'repo-guard.js');
  const install = spawnSync(process.execPath, [
    cli,
    'install-ci',
    '--provider',
    'gitlab',
    '--profile',
    'policy',
  ], { cwd: fixture.root, encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);

  const run = spawnSync(process.execPath, [
    cli,
    'ci',
    '--base',
    fixture.base,
    '--head',
    fixture.head,
    '--report-json',
    'reports/cli.json',
  ], { cwd: fixture.root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'cli.json'),
    'utf8',
  )).status, 'passed');
});

test('doctor detects attempts to weaken the managed GitLab job', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify(sparseCiConfig(), null, 2)}\n`,
  );
  installGitLabCi(fixture.root);
  const rootPath = path.join(fixture.root, '.gitlab-ci.yml');
  writeFileSync(
    rootPath,
    readFileSync(rootPath, 'utf8').replace(
      '  stage: test',
      '  stage: test\n  allow_failure: true\n  script:\n    - repo-guard ci || true',
    ),
  );
  const installedConfig = validateConfig(JSON.parse(readFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    'utf8',
  )));
  const { problems } = inspectGitLabCi(fixture.root, installedConfig);
  assert.ok(problems.includes('repo_guard 不得使用 allow_failure: true'));
  assert.ok(problems.includes('repo_guard 不得覆盖或屏蔽托管 CI 脚本'));
});

test('rejects report paths that could modify project files', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.root, 'package.json');
  const before = readFileSync(manifestPath, 'utf8');
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      ci: { enabled: true },
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
    }, null, 2)}\n`,
  );

  assert.equal(await runCiCommand(fixture.root, {
    base: fixture.base,
    head: fixture.head,
    reportPath: 'package.json',
  }), 1);
  assert.equal(readFileSync(manifestPath, 'utf8'), before);
  const invalidConfigReport = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  ));
  assert.equal(invalidConfigReport.status, 'configuration-error');
  assert.equal(invalidConfigReport.gateResult.schemaVersion, 2);
  assert.equal(invalidConfigReport.gateResult.issues[0].kind, 'configuration');

  writeFileSync(path.join(fixture.root, 'reports', 'tracked.json'), '{}\n');
  git(fixture.root, ['add', 'reports/tracked.json']);
  git(fixture.root, ['commit', '-m', 'track report']);
  await assert.rejects(
    runCiGate({
      root: fixture.root,
      config: config(),
      base: fixture.base,
      head: fixture.head,
      reportPath: 'reports/tracked.json',
      env: {},
    }),
    /不得覆盖已跟踪文件/,
  );
  assert.equal(readFileSync(path.join(fixture.root, 'reports', 'tracked.json'), 'utf8'), '{}\n');

  assert.equal(await runCiCommand(fixture.root, {
    base: fixture.base,
    head: fixture.head,
    reportPath: 'reports/tracked.json',
  }), 1);
  assert.equal(JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  )).status, 'execution-error');
});

test('writes JSON for invalid configuration and disabled CI', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(path.join(fixture.root, 'repo-guard.config.json'), '{ invalid json\n');
  assert.equal(await runCiCommand(fixture.root), 1);
  const invalidConfigReport = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  ));
  assert.equal(invalidConfigReport.status, 'configuration-error');
  assert.equal(invalidConfigReport.gateResult.schemaVersion, 2);
  assert.equal(invalidConfigReport.gateResult.issues[0].kind, 'configuration');

  assert.equal(await runCiGate({
    root: fixture.root,
    config: config({ ci: { enabled: false } }),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 1);
  const disabledReport = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'repo-guard.json'),
    'utf8',
  ));
  assert.equal(disabledReport.status, 'configuration-error');
  assert.equal(disabledReport.gateResult.issues[0].code, 'ci/disabled');
});

test('supports simple inline stages and defers ambiguous YAML to manual integration', (context) => {
  const inline = repository();
  const ambiguous = repository();
  context.after(() => {
    rmSync(inline.root, { recursive: true, force: true });
    rmSync(ambiguous.root, { recursive: true, force: true });
  });
  for (const fixture of [inline, ambiguous]) {
    writeFileSync(
      path.join(fixture.root, 'repo-guard.config.json'),
      `${JSON.stringify({
        version: 1,
        rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
      }, null, 2)}\n`,
    );
  }
  writeFileSync(path.join(inline.root, '.gitlab-ci.yml'), 'stages: [build, "verify", deploy]\n');
  const installed = installGitLabCi(inline.root);
  assert.equal(installed.integrated, true);
  assert.equal(installed.stage, 'verify');

  const original = 'stages: *shared_stages\n';
  writeFileSync(path.join(ambiguous.root, '.gitlab-ci.yml'), original);
  const deferred = installGitLabCi(ambiguous.root);
  assert.equal(deferred.integrated, false);
  assert.match(deferred.conflict, /不支持的 YAML 语法/);
  assert.equal(readFileSync(path.join(ambiguous.root, '.gitlab-ci.yml'), 'utf8'), original);
  assert.match(deferred.manualSnippet, /stage: <existing-stage>/);
  assert.throws(
    () => installGitLabCi(inline.root, { stage: 'release' }),
    /stage 未声明/,
  );
});

test('requires the managed marker at the start and detects any template modification', (context) => {
  const foreign = repository();
  const modified = repository();
  context.after(() => {
    rmSync(foreign.root, { recursive: true, force: true });
    rmSync(modified.root, { recursive: true, force: true });
  });
  for (const fixture of [foreign, modified]) {
    writeFileSync(
      path.join(fixture.root, 'repo-guard.config.json'),
      `${JSON.stringify({
        version: 1,
        rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
      }, null, 2)}\n`,
    );
  }
  mkdirSync(path.join(foreign.root, '.gitlab', 'ci'), { recursive: true });
  writeFileSync(
    path.join(foreign.root, GITLAB_TEMPLATE_FILE),
    'custom: true\n# repo-guard-gitlab-template:v1\n',
  );
  assert.throws(() => installGitLabCi(foreign.root), /拒绝覆盖非托管/);

  installGitLabCi(modified.root);
  const templatePath = path.join(modified.root, GITLAB_TEMPLATE_FILE);
  writeFileSync(
    templatePath,
    readFileSync(templatePath, 'utf8').replace('    - npm ci', '    # - npm ci'),
  );
  const installedConfig = validateConfig(JSON.parse(readFileSync(
    path.join(modified.root, 'repo-guard.config.json'),
    'utf8',
  )));
  assert.ok(inspectGitLabCi(modified.root, installedConfig).problems.some(
    (problem) => problem.includes('已被修改或过期'),
  ));
});
