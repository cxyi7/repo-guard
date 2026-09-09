import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  GITLAB_TEMPLATE_FILE, inspectGitLabCi, installGitLabCiFiles,
} from '../../src/operations/gitlab/gitlab-ci.js';

const config = { version: 2, ci: { enabled: true, profile: 'policy' } };
const unsupportedTemplate = '# repo-guard-gitlab-template:v2\n.repo_guard_previous:\n  script: npm run previous\n';

function fixture(context) {
  const base = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'quality-installer-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package-lock.json'), '{}');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@cxyi7/repo-guard': '2.0.0' } }));
  return root;
}

test('质量安装只生成质量模板，直接使用新配置且不要求部署脚本', (context) => {
  const root = fixture(context);
  const result = installGitLabCiFiles(root, config);
  assert.equal(result.integrated, true);
  assert.equal(Object.hasOwn(result, 'pipelineEnabled'), false);
  assert.deepEqual(inspectGitLabCi(root, config).problems, []);
  const template = readFileSync(path.join(root, GITLAB_TEMPLATE_FILE), 'utf8');
  assert.match(template, /^# repo-guard-gitlab-template:v3/);
  assert.doesNotMatch(template, /repo_guard_pipeline|deploy|ci-notify/);
  assert.equal(installGitLabCiFiles(root, config).rootChanged, false);
});

test('旧版本质量模板不再自动升级，旧模板与根文件保持原样', (context) => {
  const root = fixture(context);
  installGitLabCiFiles(root, config);
  const file = path.join(root, GITLAB_TEMPLATE_FILE);
  const rootFile = path.join(root, '.gitlab-ci.yml');
  const originalRoot = readFileSync(rootFile, 'utf8');
  for (const content of [
    unsupportedTemplate,
    unsupportedTemplate.replace(':v2', ':v1'),
    unsupportedTemplate.replace(':v2', ':v99'),
    unsupportedTemplate.replaceAll('\n', '\r\n'),
  ]) {
    writeFileSync(file, content);
    assert.throws(() => installGitLabCiFiles(root, config), /拒绝覆盖/);
    assert.throws(() => installGitLabCiFiles(root, config, { dryRun: true }), /拒绝覆盖/);
    assert.equal(readFileSync(file, 'utf8'), content);
    assert.equal(readFileSync(rootFile, 'utf8'), originalRoot);
    assert.match(inspectGitLabCi(root, config).problems.join('\n'), /未由 repo-guard 托管/);
  }
});

test('当前标记下的人工修改模板不会被覆盖', (context) => {
  const root = fixture(context);
  installGitLabCiFiles(root, config);
  const file = path.join(root, GITLAB_TEMPLATE_FILE);
  const changed = `${readFileSync(file, 'utf8')}# 团队手工补充\n`;
  writeFileSync(file, changed);
  assert.throws(() => installGitLabCiFiles(root, config), /拒绝覆盖非托管或人工修改/);
  assert.equal(readFileSync(file, 'utf8'), changed);
});

test('根区块包含非当前作业时要求人工接入，冲突时根文件和模板均保持不变', (context) => {
  const root = fixture(context);
  installGitLabCiFiles(root, config);
  const file = path.join(root, '.gitlab-ci.yml');
  const content = readFileSync(file, 'utf8').replace('# repo-guard-gitlab:end', 'repo_guard_deploy_test:\n  script: npm run deploy\n# repo-guard-gitlab:end');
  writeFileSync(file, content);
  const originalTemplate = readFileSync(path.join(root, GITLAB_TEMPLATE_FILE), 'utf8');
  const result = installGitLabCiFiles(root, config);
  assert.equal(result.integrated, false);
  assert.match(result.conflict, /人工修改/);
  assert.equal(readFileSync(file, 'utf8'), content);
  assert.equal(readFileSync(path.join(root, GITLAB_TEMPLATE_FILE), 'utf8'), originalTemplate);
});

test('质量根块人工添加脚本或弱化规则时拒绝覆写，但允许修改 profile 的正常升级', (context) => {
  const root = fixture(context);
  installGitLabCiFiles(root, config);
  const full = { version: 2, ci: { enabled: true, profile: 'full' } };
  assert.equal(installGitLabCiFiles(root, full, { profile: 'full' }).integrated, true);
  assert.deepEqual(inspectGitLabCi(root, full).problems, []);
  const file = path.join(root, '.gitlab-ci.yml');
  const changed = readFileSync(file, 'utf8').replace('  stage: test', '  stage: test\n  allow_failure: true');
  writeFileSync(file, changed);
  assert.match(installGitLabCiFiles(root, full, { profile: 'full' }).conflict, /人工修改/);
  assert.equal(readFileSync(file, 'utf8'), changed);
});

test('自定义根流水线引用非当前模板时，拒绝替换也不删除用户文件', (context) => {
  const root = fixture(context);
  installGitLabCiFiles(root, config);
  const file = path.join(root, '.gitlab-ci.yml');
  const content = 'include:\n  - local: /.gitlab/ci/repo-guard.yml\nteam_deploy:\n  extends: .repo_guard_pipeline_base\n  script: npm run deploy\n';
  writeFileSync(file, content);
  writeFileSync(path.join(root, GITLAB_TEMPLATE_FILE), unsupportedTemplate);
  assert.throws(() => installGitLabCiFiles(root, config), /拒绝覆盖/);
  assert.equal(readFileSync(file, 'utf8'), content);
  assert.equal(readFileSync(path.join(root, GITLAB_TEMPLATE_FILE), 'utf8'), unsupportedTemplate);
});
