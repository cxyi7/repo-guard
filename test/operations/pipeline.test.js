import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { planOperationsPipeline } from '../../src/operations/pipeline/plan.js';
import { inspectOperationsGitLabPipeline, installOperationsGitLabPipeline } from '../../src/operations/gitlab/installation.js';
import { OPERATIONS_PIPELINE_FILE, renderOperationsGitLabPipeline } from '../../src/operations/gitlab/renderer.js';
import { renderManagedPipelineRoot as bridge } from '../../src/orchestration/setup/gitlab-managed-pipeline.js';
import { renderManagedPipelineRoot as implementation } from '../../src/operations/gitlab/gitlab-managed-pipeline.js';
import { inspectGitLabCi as inspectBridge } from '../../src/orchestration/setup/gitlab-ci.js';
import { inspectGitLabCi as inspectImplementation } from '../../src/operations/gitlab/gitlab-ci.js';
import { runGitLabCiNotification as notifyBridge } from '../../src/gates/release/gitlab-ci-notification.js';
import { runGitLabCiNotification as notifyImplementation } from '../../src/operations/notifications/gitlab-ci-notification.js';
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
  assert.match(inspectOperationsGitLabPipeline(root, operations(), projects).problems.join('\n'), /已修改/);
  assert.throws(() => installOperationsGitLabPipeline(root, { version: 2 }, projects), /仍存在/);
});

test('拒绝覆盖同路径的自定义流水线', (context) => {
  const { root, projects } = fixture(context);
  mkdirSync(path.join(root, '.gitlab/ci'), { recursive: true });
  writeFileSync(path.join(root, OPERATIONS_PIPELINE_FILE), 'custom-job:\n  script: echo custom\n');
  assert.throws(() => installOperationsGitLabPipeline(root, operations(), projects), /拒绝覆盖/);
});

test('旧安装、渲染和通知入口使用运维实现，保持公共契约', () => {
  assert.equal(bridge, implementation);
  assert.equal(inspectBridge, inspectImplementation);
  assert.equal(notifyBridge, notifyImplementation);
  assert.deepEqual(bridge({ enabled: false }), { gateOverrides: '', jobs: '' });
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
