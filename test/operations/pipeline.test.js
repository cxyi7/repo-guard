import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { planOperationsPipeline } from '../../src/operations/pipeline/plan.js';
import { inspectOperationsGitLabPipeline, installOperationsGitLabPipeline } from '../../src/operations/gitlab/installation.js';
import { OPERATIONS_PIPELINE_FILE, renderOperationsGitLabPipeline } from '../../src/operations/gitlab/renderer.js';
import { nodeArtifactVerificationProgram } from '../../src/operations/providers/node.js';

function fixture(context) {
  const directory = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(path.join(directory, 'operations-pipeline-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const projects = ['web', 'api'].map((id) => ({ id, root: `apps/${id}`, stack: 'node' }));
  for (const project of projects) {
    mkdirSync(path.join(root, project.root), { recursive: true });
    writeFileSync(path.join(root, project.root, 'package.json'), JSON.stringify({
      scripts: { build: 'node build.js', 'deploy:production': 'node deploy.js', 'deploy:test': 'node deploy-test.js' },
    }));
  }
  return { root, projects };
}

function operations() {
  const unit = {
    enabled: true,
    buildScript: 'build',
    artifactPaths: ['dist/'],
    environments: {
      production: { script: 'deploy:production', branches: ['main'] },
      test: { script: 'deploy:test', branches: ['dev'], production: false },
    },
  };
  return { version: 2, enabled: true, projects: { web: unit, api: unit } };
}

test('两应用生成独立作业和环境，每次部署绑定本应用质量与构建产物', (context) => {
  const { root, projects } = fixture(context);
  const plan = planOperationsPipeline(root, operations(), projects);
  const yaml = renderOperationsGitLabPipeline(plan);
  const jobs = plan.projects.flatMap((project) => [project.quality.job, project.build.job, ...project.deployments.map((deployment) => deployment.job)]);
  assert.equal(new Set(jobs).size, jobs.length);
  for (const project of plan.projects) {
    assert.equal(project.quality.command, `npx --no-install repo-guard ci --project ${project.projectId} --profile full`);
    assert.deepEqual(project.build.artifactPaths, [`apps/${project.projectId}/dist`]);
    const start = yaml.indexOf(`"repo_guard_deploy__${project.projectId}__production":`);
    const end = yaml.indexOf('\n\n', start);
    const job = yaml.slice(start, end === -1 ? undefined : end);
    assert.match(job, new RegExp(`job: "${project.quality.job}"\n      artifacts: false`));
    assert.match(job, new RegExp(`job: "${project.build.job}"\n      artifacts: true`));
    assert.match(job, new RegExp(`name: "${project.projectId}/production"`));
    assert.match(job, /when: manual/);
    assert.doesNotMatch(job, /optional: true|allow_failure: true/);
  }
  assert.doesNotMatch(yaml, /npm install|npm ci|npm publish|\|\| true|trigger:/);
});

test('没有开启运维时不识别应用或生成部署，单独禁用应用不会产生作业', (context) => {
  const { root, projects } = fixture(context);
  assert.equal(renderOperationsGitLabPipeline(planOperationsPipeline(root, { version: 2 }, null)), '');
  const config = operations();
  config.projects.api = { enabled: false };
  const plan = planOperationsPipeline(root, config, projects);
  assert.deepEqual(plan.projects.map((project) => project.projectId), ['web']);
});

test('拒绝未声明应用、不支持的 Java 和缺失部署脚本', (context) => {
  const { root, projects } = fixture(context);
  assert.throws(() => planOperationsPipeline(root, operations(), projects.slice(0, 1)), /未声明的项目/);
  assert.throws(() => planOperationsPipeline(root, operations(), projects.map((project) => ({ ...project, stack: 'java' }))), /尚未提供/);
  const config = operations();
  config.projects.api = { ...config.projects.api, buildScript: 'missing:build' };
  assert.throws(() => planOperationsPipeline(root, config, projects), /未声明脚本.*missing:build/);
});

test('生成流水线不覆盖现有根配置且再次安装保持不变', (context) => {
  const { root, projects } = fixture(context);
  const original = 'include:\n  - local: /custom.yml\n';
  writeFileSync(path.join(root, '.gitlab-ci.yml'), original);
  const preview = installOperationsGitLabPipeline(root, operations(), projects, { dryRun: true });
  assert.equal(preview.integrated, false);
  assert.equal(existsSync(path.join(root, OPERATIONS_PIPELINE_FILE)), false);
  const result = installOperationsGitLabPipeline(root, operations(), projects);
  assert.equal(result.integrated, false);
  assert.match(result.manualSnippet, /repo-guard-operations/);
  assert.equal(readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8'), original);
  assert.equal(installOperationsGitLabPipeline(root, operations(), projects).pipelineChanged, false);
});

test('空仓库安装独立根引用，禁用时提示清理残留部署配置', (context) => {
  const { root, projects } = fixture(context);
  assert.equal(installOperationsGitLabPipeline(root, { version: 2 }, projects).enabled, false);
  assert.equal(existsSync(path.join(root, '.gitlab-ci.yml')), false);
  assert.equal(installOperationsGitLabPipeline(root, operations(), projects).integrated, true);
  assert.deepEqual(inspectOperationsGitLabPipeline(root, operations(), projects).problems, []);
  const generatedFile = path.join(root, OPERATIONS_PIPELINE_FILE);
  writeFileSync(generatedFile, readFileSync(generatedFile, 'utf8').replace('allow_failure: false', 'allow_failure: true'));
  assert.match(inspectOperationsGitLabPipeline(root, operations(), projects).problems.join('\n'), /人工修改/);
  const changed = readFileSync(generatedFile, 'utf8');
  assert.throws(() => installOperationsGitLabPipeline(root, operations(), projects), /拒绝覆盖人工修改/);
  assert.equal(readFileSync(generatedFile, 'utf8'), changed);
  const preview = installOperationsGitLabPipeline(root, operations(), projects, { dryRun: true });
  assert.equal(preview.integrated, false);
  assert.match(preview.guidance, /拒绝覆盖人工修改/);
  assert.match(renderOperationsGitLabPipeline(preview.plan), /allow_failure: false/);
  assert.equal(readFileSync(generatedFile, 'utf8'), changed);
  assert.throws(() => installOperationsGitLabPipeline(root, { version: 2 }, projects), /仍存在/);
});

test('拒绝覆盖同路径的自定义流水线', (context) => {
  const { root, projects } = fixture(context);
  mkdirSync(path.join(root, '.gitlab/ci'), { recursive: true });
  writeFileSync(path.join(root, OPERATIONS_PIPELINE_FILE), 'custom-job:\n  script: echo custom\n');
  assert.throws(() => installOperationsGitLabPipeline(root, operations(), projects), /拒绝覆盖/);
});

test('关闭通知时不生成通知作业，显式开启才生成成功失败及尽力取消通知', (context) => {
  const { root, projects } = fixture(context);
  const plain = renderOperationsGitLabPipeline(planOperationsPipeline(root, operations(), projects));
  assert.doesNotMatch(plain, /ci-notify|OPERATIONS_NOTIFICATION|after_script/);
  const enabled = { ...operations(), notifications: { enabled: true } };
  const pipeline = renderOperationsGitLabPipeline(planOperationsPipeline(root, enabled, projects));
  assert.match(pipeline, /repo_guard_operations_notify_success/);
  assert.match(pipeline, /repo_guard_operations_notify_failed/);
  assert.match(pipeline, /ci-notify --status success/);
  assert.match(pipeline, /ci-notify --status failed/);
  assert.match(pipeline, /ci-notify --status canceled/);
  assert.match(pipeline, /when: on_success/);
  assert.match(pipeline, /when: on_failure/);
  assert.match(pipeline, /REPO_GUARD_OPERATIONS_NOTIFICATIONS: "true"/);
  assert.doesNotMatch(pipeline, /REPO_GUARD_PIPELINE_NOTIFICATION|npm install|npm ci|ci\.pipeline/);
  const notifications = pipeline.slice(pipeline.indexOf('"repo_guard_operations_notify_success":'));
  assert.match(notifications, /allow_failure: true/);
  assert.doesNotMatch(notifications, /needs:|artifacts:/);
});

test('成功与失败通知覆盖与质量构建相同的 MR 和分支流水线，保留各自状态条件', (context) => {
  const { root, projects } = fixture(context);
  const config = { ...operations(), notifications: { enabled: true } };
  const plan = planOperationsPipeline(root, config, projects);
  const pipeline = parseYaml(renderOperationsGitLabPipeline(plan));
  const expectedRules = [
    { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
    { if: '$CI_COMMIT_BRANCH' },
  ];
  for (const project of plan.projects) {
    for (const name of [project.quality.job, project.build.job]) {
      assert.deepEqual(pipeline[name].rules, expectedRules);
      assert.equal(pipeline[name].variables.REPO_GUARD_OPERATIONS_NOTIFICATIONS, 'true');
    }
  }
  for (const [status, when] of [['success', 'on_success'], ['failed', 'on_failure']]) {
    const job = pipeline[`repo_guard_operations_notify_${status}`];
    // GitLab 未声明 rules 的作业默认排除 MR；统一通知必须覆盖被去重的质量作业。
    assert.deepEqual(job.rules, expectedRules, `${status} 通知必须包含 MR 和分支规则`);
    assert.equal(job.when, when);
    assert.equal(job.stage, '.post');
    assert.equal(job.allow_failure, true);
    assert.equal(Object.hasOwn(job, 'needs'), false);
    assert.equal(job.variables.REPO_GUARD_OPERATIONS_NOTIFICATION, 'true');
    assert.ok(job.script.includes(`npx --no-install repo-guard ci-notify --status ${status}`));
  }
});

test('无摘要片段即使与当前内容相同也不再收养，保留文件供人工接入', (context) => {
  const { root, projects } = fixture(context);
  const config = operations();
  installOperationsGitLabPipeline(root, config, projects);
  const file = path.join(root, OPERATIONS_PIPELINE_FILE);
  const original = readFileSync(file, 'utf8');
  const rootFile = path.join(root, '.gitlab-ci.yml');
  const originalRoot = readFileSync(rootFile, 'utf8');
  const unmarked = original.replace(/^# repo-guard-content-sha256: [a-f0-9]{64}\n/m, '');
  writeFileSync(file, unmarked);
  assert.throws(() => installOperationsGitLabPipeline(root, config, projects), /非托管/);
  const preview = installOperationsGitLabPipeline(root, config, projects, { dryRun: true });
  assert.equal(preview.integrated, false);
  assert.match(preview.guidance, /非托管/);
  assert.match(inspectOperationsGitLabPipeline(root, config, projects).problems.join('\n'), /非托管/);
  assert.equal(readFileSync(file, 'utf8'), unmarked);
  assert.equal(readFileSync(rootFile, 'utf8'), originalRoot);
});

test('当前带摘要片段允许配置变化后的更新和再次安装', (context) => {
  const { root, projects } = fixture(context);
  const config = operations();
  installOperationsGitLabPipeline(root, config, projects);
  const updated = { ...config, notifications: { enabled: true } };
  assert.equal(installOperationsGitLabPipeline(root, updated, projects).pipelineChanged, true);
  assert.deepEqual(inspectOperationsGitLabPipeline(root, updated, projects).problems, []);
  assert.equal(installOperationsGitLabPipeline(root, updated, projects).pipelineChanged, false);
});

test('构建成功却缺失或只有空目录时产物检查阻断，真实文件才通过', (context) => {
  const { root } = fixture(context);
  const verify = () => spawnSync(process.execPath, ['--input-type=commonjs', '-e', nodeArtifactVerificationProgram(), 'dist'], {
    cwd: root, encoding: 'utf8',
  });
  assert.notEqual(verify().status, 0);
  mkdirSync(path.join(root, 'dist'));
  assert.notEqual(verify().status, 0);
  writeFileSync(path.join(root, 'dist', 'app.js'), 'export const ready = true;');
  assert.equal(verify().status, 0);
});
