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
import { renderManagedPipelineRoot } from '../src/orchestration/setup/gitlab-managed-pipeline.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function yamlJob(content, name) {
  const match = new RegExp(
    `^${name}:\\n[\\s\\S]*?(?=^[A-Za-z0-9_]+:\\n|^# repo-guard-gitlab:end)`,
    'm',
  ).exec(content);
  assert.ok(match, `缺少 GitLab CI 受管 Job：${name}`);
  return match[0];
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

function configWithCiGatePolicy(reportPath, gates, defaultMode = 'inherit') {
  return config({
    ci: {
      enabled: true,
      profile: 'policy',
      reportPath,
      protectedFiles: { action: 'report' },
      gatePolicy: { defaultMode, gates },
    },
  });
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
    { name: 'repository.commit-message', status: 'skipped' },
    { name: 'async-resource-cleanup', status: 'skipped' },
    { name: 'path-naming', status: 'skipped' },
    { name: 'dynamic-code', status: 'passed' },
    { name: 'security.vue-unsafe-html', status: 'passed' },
    { name: 'security.vue-target-blank', status: 'passed' },
    { name: 'accessibility.vue-form-label', status: 'passed' },
    { name: 'accessibility.vue-image-alt', status: 'passed' },
    { name: 'dependencies.policy', status: 'skipped' },
    { name: 'repository.file-placement', status: 'skipped' },
    { name: 'repository.code-placement', status: 'skipped' },
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

test('CI enforce 模式启用并阻断异步资源清理错误', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'src', 'App.vue'),
    '<script setup>\nconst timer = setInterval(refresh, 1000);\n</script>\n',
  );
  git(fixture.root, ['add', '.']);
  git(fixture.root, ['commit', '-m', 'add leaking component']);
  const head = git(fixture.root, ['rev-parse', 'HEAD']);

  const enforceConfig = configWithCiGatePolicy('reports/async-enforce.json', {
    'quality.vue-async-resource-cleanup': { mode: 'enforce' },
  });
  assert.equal(await runCiGate({
    root: fixture.root,
    config: enforceConfig,
    base: fixture.base,
    head,
    env: {},
  }), 2);
  const enforceReport = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'async-enforce.json'),
    'utf8',
  ));
  const enforceStep = enforceReport.steps.find(({ name }) => name === 'async-resource-cleanup');
  assert.equal(enforceStep.status, 'failed');
  assert.equal(enforceStep.gateResult.status, 'violation');
  assert.equal(enforceStep.gateResult.findings[0].severity, 'error');

  const reportConfig = configWithCiGatePolicy('reports/async-report.json', {
    'quality.vue-async-resource-cleanup': { mode: 'report' },
  });
  assert.equal(await runCiGate({
    root: fixture.root,
    config: reportConfig,
    base: fixture.base,
    head,
    env: {},
  }), 0);
  const report = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'async-report.json'),
    'utf8',
  ));
  assert.equal(
    report.steps.find(({ name }) => name === 'async-resource-cleanup').status,
    'failed',
  );
});

test('CI enforce 模式启用并阻断全项目路径命名错误', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'src', 'committee-info.js'),
    'export const committeeInfo = true;\n',
  );
  git(fixture.root, ['add', '.']);
  git(fixture.root, ['commit', '-m', 'add invalid path']);
  const head = git(fixture.root, ['rev-parse', 'HEAD']);
  const enforceConfig = configWithCiGatePolicy('reports/path-naming-enforce.json', {
    'repository.path-naming': { mode: 'enforce' },
  });

  assert.equal(await runCiGate({
    root: fixture.root,
    config: enforceConfig,
    base: fixture.base,
    head,
    env: {},
  }), 2);
  const report = JSON.parse(readFileSync(
    path.join(fixture.root, 'reports', 'path-naming-enforce.json'),
    'utf8',
  ));
  const step = report.steps.find(({ name }) => name === 'path-naming');
  assert.equal(step.status, 'failed');
  assert.equal(step.gateResult.status, 'violation');
  assert.equal(step.gateResult.findings[0].ruleId, 'repository/path-naming');
  assert.equal(step.gateResult.findings[0].severity, 'error');
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

test('applies off, report, enforce, and changed-file modes only to CI', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(
    path.join(fixture.root, 'src', 'unsafe.js'),
    'export const unsafe = (payload) => eval(payload);\n',
  );

  const cases = [
    { mode: 'off', exitCode: 0, reportPath: 'reports/off.json', status: 'passed', step: 'skipped' },
    { mode: 'report', exitCode: 0, reportPath: 'reports/report.json', status: 'passed', step: 'failed' },
    { mode: 'enforce', exitCode: 2, reportPath: 'reports/enforce.json', status: 'failed', step: 'failed' },
  ];
  for (const item of cases) {
    const policy = { 'security.dynamic-code': { mode: item.mode } };
    assert.equal(await runCiGate({
      root: fixture.root,
      config: configWithCiGatePolicy(item.reportPath, policy),
      base: fixture.base,
      head: fixture.head,
      env: {},
    }), item.exitCode);
    const report = JSON.parse(readFileSync(path.join(fixture.root, item.reportPath), 'utf8'));
    const step = report.steps.find(({ name }) => name === 'dynamic-code');
    assert.equal(report.status, item.status);
    assert.equal(step.status, item.step);
    assert.deepEqual(step.gatePolicy, {
      mode: item.mode,
      scope: 'all-files',
      blocking: item.mode === 'enforce',
    });
  }

  const changedReportPath = 'reports/changed-files.json';
  assert.equal(await runCiGate({
    root: fixture.root,
    config: configWithCiGatePolicy(changedReportPath, {
      'security.dynamic-code': { mode: 'enforce', scope: 'changed-files' },
    }),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 0);
  const changedReport = JSON.parse(readFileSync(
    path.join(fixture.root, changedReportPath),
    'utf8',
  ));
  const changedStep = changedReport.steps.find(({ name }) => name === 'dynamic-code');
  assert.equal(changedStep.status, 'passed');
  assert.deepEqual(changedStep.gatePolicy, {
    mode: 'enforce',
    scope: 'changed-files',
    blocking: true,
  });
});

test('rejects CI Gate policy ids that are absent from the project Registry', async (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const reportPath = 'reports/invalid-gate-policy.json';

  assert.equal(await runCiGate({
    root: fixture.root,
    config: configWithCiGatePolicy(reportPath, {
      'quality.not-installed': { mode: 'off' },
    }),
    base: fixture.base,
    head: fixture.head,
    env: {},
  }), 1);
  const report = JSON.parse(readFileSync(path.join(fixture.root, reportPath), 'utf8'));
  assert.equal(report.status, 'configuration-error');
  assert.match(report.gateResult.summary, /未知或非 CI 门禁/);
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
  assert.match(template, /repo-guard-gitlab-template:v2/);
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

  const rootPath = path.join(fixture.root, '.gitlab-ci.yml');
  const templatePath = path.join(fixture.root, GITLAB_TEMPLATE_FILE);
  const windowsRoot = installedRoot.replaceAll('\n', '\r\n');
  const windowsTemplate = template.replaceAll('\n', '\r\n');
  writeFileSync(rootPath, windowsRoot);
  writeFileSync(templatePath, windowsTemplate);

  const repeat = installGitLabCi(fixture.root, { profile: 'policy' });
  assert.equal(repeat.rootChanged, false);
  assert.equal(repeat.templateChanged, false);
  assert.equal(readFileSync(rootPath, 'utf8'), windowsRoot);
  assert.equal(readFileSync(templatePath, 'utf8'), windowsTemplate);
});

test('installs the managed application-delivery contract from project configuration', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.root, 'package.json');
  const manifest = {
    ...JSON.parse(readFileSync(manifestPath, 'utf8')),
    scripts: {
      'ci:verify': 'node verify.js',
      'ci:deploy:test': 'node deploy.js test',
      'ci:deploy:production': 'node deploy.js production',
      'ci:deploy:quick': 'node deploy.js quick',
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    path.join(fixture.root, '.gitlab-ci.yml'),
    'stages:\n  - build\n  - deploy\n\nexisting_job:\n  stage: build\n  script:\n    - echo existing\n',
  );
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify({
      ...sparseCiConfig(),
      ci: {
        pipeline: {
          enabled: true,
          testBranches: ['dev', 'future/*'],
          productionBranches: ['publish'],
          runnerTags: ['docker'],
          deployImage: 'registry.example.com:5050/ci/node-docker:22',
          legacyPeerDeps: true,
          quickDeploy: true,
          notifications: true,
        },
      },
    }, null, 2)}\n`,
  );

  const installed = installGitLabCi(fixture.root, { profile: 'full' });
  assert.equal(installed.pipelineEnabled, true);
  assert.equal(installed.stage, '.pre');
  const root = readFileSync(path.join(fixture.root, '.gitlab-ci.yml'), 'utf8');
  const template = readFileSync(path.join(fixture.root, GITLAB_TEMPLATE_FILE), 'utf8');
  assert.match(template, /\.repo_guard_pipeline_legacy_peer_deps_base:/);
  assert.match(template, /npm ci --legacy-peer-deps/);
  assert.match(template, /GIT_DEPTH: "0"/);
  assert.match(root, /repo_guard:[\s\S]*stage: \.pre/);
  assert.match(root, /repo_guard_verify:/);
  assert.match(root, /npm run ci:verify/);
  assert.match(root, /repo_guard_deploy_test:/);
  assert.match(root, /image: registry\.example\.com:5050\/ci\/node-docker:22/);
  assert.match(root, /\$CI_COMMIT_BRANCH == "dev"/);
  assert.match(root, /\$CI_COMMIT_BRANCH =~ \/\^future\\\/\.\*\$\//);
  assert.match(root, /repo_guard_deploy_production:[\s\S]*npm run ci:deploy:production/);
  assert.match(root, /repo_guard_deploy_quick:[\s\S]*allow_failure: true/);
  assert.doesNotMatch(root, /npm run ci:notify|npx --yes|--package=@cxyi7\/repo-guard/);
  const managedJobNames = [
    'repo_guard',
    'repo_guard_verify',
    'repo_guard_deploy_test',
    'repo_guard_deploy_production',
    'repo_guard_deploy_quick',
    'repo_guard_notify_success',
    'repo_guard_notify_failure',
  ];
  for (const jobName of managedJobNames) {
    const job = yamlJob(root, jobName);
    assert.match(job, /after_script:/);
    assert.match(job, /CI_JOB_STATUS" = "canceled"/);
    assert.match(job, /--status canceled/);
  }
  assert.match(yamlJob(root, 'repo_guard'), /interruptible: true/);
  assert.match(yamlJob(root, 'repo_guard_verify'), /interruptible: true/);
  assert.doesNotMatch(yamlJob(root, 'repo_guard_deploy_test'), /interruptible: true/);
  assert.doesNotMatch(yamlJob(root, 'repo_guard_deploy_production'), /interruptible: true/);
  assert.doesNotMatch(yamlJob(root, 'repo_guard_deploy_quick'), /interruptible: true/);
  assert.match(
    root,
    /npm install --ignore-scripts --no-save --package-lock=false --audit=false --fund=false --prefix "\$CI_BUILDS_DIR\/.repo-guard-notify-\$CI_PROJECT_ID-\$CI_PIPELINE_ID-\$CI_JOB_ID" https:\/\/registry\.npmjs\.org\/@cxyi7\/repo-guard\/-\/repo-guard-1\.17\.0\.tgz/,
  );
  assert.match(
    root,
    /REPO_GUARD_PIPELINE_NOTIFICATION=true node "\$CI_BUILDS_DIR\/.repo-guard-notify-\$CI_PROJECT_ID-\$CI_PIPELINE_ID-\$CI_JOB_ID\/node_modules\/@cxyi7\/repo-guard\/bin\/repo-guard\.js" ci-notify --status canceled/,
  );
  assert.match(
    root,
    /repo_guard_notify_success:[\s\S]*?stage: \.post[\s\S]*?before_script: \[\][\s\S]*?repo-guard-1\.17\.0\.tgz[\s\S]*?repo-guard\.js" ci-notify --status success[\s\S]*?when: on_success[\s\S]*?allow_failure: true/,
  );
  assert.match(
    root,
    /repo_guard_notify_failure:[\s\S]*?stage: \.post[\s\S]*?before_script: \[\][\s\S]*?repo-guard-1\.17\.0\.tgz[\s\S]*?repo-guard\.js" ci-notify --status failed[\s\S]*?when: on_failure[\s\S]*?allow_failure: true/,
  );
  assert.match(root, /repo_guard:[\s\S]*- if: '\$CI_COMMIT_BRANCH'/);
  const installedConfig = validateConfig(JSON.parse(readFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    'utf8',
  )));
  assert.deepEqual(inspectGitLabCi(fixture.root, installedConfig).problems, []);

  assert.equal(Object.hasOwn(manifest.scripts, 'ci:notify'), false);
  assert.throws(
    () => installGitLabCi(fixture.root, { profile: 'full', stage: 'build' }),
    /固定使用 \.pre 阶段/,
  );
});

test('does not add cancellation behavior when managed notifications are disabled', () => {
  const pipeline = validateConfig({
    ...sparseCiConfig(),
    ci: { pipeline: { enabled: true, notifications: false } },
  }).ci.pipeline;
  const rendered = renderManagedPipelineRoot(pipeline);
  const content = `${rendered.gateOverrides}${rendered.jobs}`;

  assert.doesNotMatch(content, /after_script:|interruptible: true|repo_guard_notify_/);
});

test('refuses to install managed delivery until required project scripts exist', (context) => {
  const fixture = repository();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const original = 'stages: [build, deploy]\n';
  writeFileSync(path.join(fixture.root, '.gitlab-ci.yml'), original);
  writeFileSync(
    path.join(fixture.root, 'repo-guard.config.json'),
    `${JSON.stringify({
      ...sparseCiConfig(),
      ci: { pipeline: { enabled: true, quickDeploy: true, notifications: true } },
    }, null, 2)}\n`,
  );

  assert.throws(
    () => installGitLabCi(fixture.root),
    /ci:verify.*ci:deploy:test.*ci:deploy:production.*ci:deploy:quick/,
  );
  assert.equal(readFileSync(path.join(fixture.root, '.gitlab-ci.yml'), 'utf8'), original);
  assert.equal(existsSync(path.join(fixture.root, GITLAB_TEMPLATE_FILE)), false);
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

test('reserves managed delivery job names only while application delivery is enabled', (context) => {
  const gateOnly = repository();
  const managedDelivery = repository();
  context.after(() => {
    rmSync(gateOnly.root, { recursive: true, force: true });
    rmSync(managedDelivery.root, { recursive: true, force: true });
  });
  const existingJob = 'repo_guard_verify:\n  stage: build\n  script:\n    - npm run verify\n';
  writeFileSync(path.join(gateOnly.root, '.gitlab-ci.yml'), existingJob);
  writeFileSync(
    path.join(gateOnly.root, 'repo-guard.config.json'),
    `${JSON.stringify(sparseCiConfig(), null, 2)}\n`,
  );
  assert.equal(installGitLabCi(gateOnly.root).integrated, true);
  assert.match(readFileSync(path.join(gateOnly.root, '.gitlab-ci.yml'), 'utf8'), /repo_guard_verify:/);

  const manifestPath = path.join(managedDelivery.root, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify({
    ...manifest,
    scripts: {
      'ci:verify': 'node verify.js',
      'ci:deploy:test': 'node deploy.js test',
      'ci:deploy:production': 'node deploy.js production',
    },
  }, null, 2)}\n`);
  writeFileSync(
    path.join(managedDelivery.root, '.gitlab-ci.yml'),
    `stages: [build, deploy]\n${existingJob}`,
  );
  writeFileSync(
    path.join(managedDelivery.root, 'repo-guard.config.json'),
    `${JSON.stringify({
      ...sparseCiConfig(),
      ci: { pipeline: { enabled: true } },
    }, null, 2)}\n`,
  );
  const result = installGitLabCi(managedDelivery.root);
  assert.equal(result.integrated, false);
  assert.match(result.conflict, /保留作业 repo_guard_verify/);
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

test('requires the current managed marker and detects any template modification', (context) => {
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
    '# repo-guard-gitlab-template:v1\ncustom: true\n',
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
