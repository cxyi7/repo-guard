import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPERATIONS_PIPELINE_FILE } from '../../src/operations/gitlab/renderer.js';

const CLI = fileURLToPath(new URL('../../bin/repo-guard.js', import.meta.url));

function fixture(context) {
  const temporaryRoot = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  const root = mkdtempSync(path.join(temporaryRoot, 'operations-cli-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore', windowsHide: true });
  const projects = ['web', 'api'].map((id) => ({ id, root: `apps/${id}` }));
  const json = (file, value) => writeFileSync(path.join(root, file), JSON.stringify(value));
  for (const project of projects) {
    mkdirSync(path.join(root, project.root), { recursive: true });
    json(`${project.root}/package.json`, { scripts: { build: 'node build.js', deploy: 'node deploy.js' } });
    json(`${project.root}/repo-guard.config.json`, {
      version: 2,
      project: {
        id: project.id, stack: 'node',
        role: project.id === 'web' ? 'frontend' : 'backend',
        preset: project.id === 'web' ? 'vue-javascript' : 'node-javascript',
      },
    });
  }
  json('repo-guard.config.json', { version: 2, projects, ci: { enabled: true } });
  json('repo-guard.ops.json', {
    version: 2, enabled: true,
    projects: Object.fromEntries(projects.map(({ id }) => [id, {
      enabled: true, buildScript: 'build', artifactPaths: ['dist/'],
      environments: { production: { script: 'deploy', branches: ['main'] } },
    }])),
  });
  return root;
}

function run(root, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, 'ops', ...argumentsList], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('实际运维 CLI 从仓库和应用目录预览两应用，保持相对路径且不写流水线', (context) => {
  const root = fixture(context);
  for (const [cwd, args] of [[root, ['plan']], [path.join(root, 'apps/api'), ['install', '--dry-run']]]) {
    const output = run(cwd, ...args);
    for (const id of ['web', 'api']) {
      assert.match(output, new RegExp(`repo-guard ci --project ${id} --profile full`));
      assert.match(output, new RegExp(`apps/${id}/dist`));
    }
    assert.equal(existsSync(path.join(root, '.gitlab-ci.yml')), false);
    assert.equal(existsSync(path.join(root, OPERATIONS_PIPELINE_FILE)), false);
  }
});

test('实际运维 CLI 安装只生成配置，重复执行保持内容并隔离应用发布作业', (context) => {
  const root = fixture(context);
  run(root, 'install');
  const pipeline = readFileSync(path.join(root, OPERATIONS_PIPELINE_FILE), 'utf8');
  const rootPipeline = readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8');
  assert.match(rootPipeline, /repo-guard-operations/);
  assert.match(pipeline, /repo_guard_deploy__web__production/);
  assert.match(pipeline, /repo_guard_deploy__api__production/);
  assert.match(pipeline, /when: manual/);
  run(root, 'install');
  assert.equal(readFileSync(path.join(root, OPERATIONS_PIPELINE_FILE), 'utf8'), pipeline);
  assert.equal(readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8'), rootPipeline);
});

test('启用运维但质量 CI 关闭时提前阻止预览与安装，不生成发布文件', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  for (const ci of [undefined, { enabled: false }]) {
    writeFileSync(file, JSON.stringify({ ...document, ci }));
    for (const command of ['plan', 'install']) {
      const result = spawnSync(process.execPath, [CLI, 'ops', command], {
        cwd: root, encoding: 'utf8', windowsHide: true,
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /operations\/quality-ci-disabled/);
      assert.match(`${result.stdout}\n${result.stderr}`, /ci\.enabled.*false/);
      assert.equal(existsSync(path.join(root, '.gitlab-ci.yml')), false);
      assert.equal(existsSync(path.join(root, OPERATIONS_PIPELINE_FILE)), false);
    }
  }
});

test('未启用运维时可以预览关闭状态，不要求打开质量 CI', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'repo-guard.config.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...document, ci: { enabled: false } }));
  writeFileSync(path.join(root, 'repo-guard.ops.json'), JSON.stringify({ version: 2, enabled: false }));
  assert.match(run(root, 'plan'), /运维发布未启用/);
  assert.equal(existsSync(path.join(root, '.gitlab-ci.yml')), false);
});
