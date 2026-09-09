import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runDoctor } from '../../src/orchestration/doctor/runner.js';
import { repairRepository } from '../../src/orchestration/setup/repository-repair.js';
import { installGitLabCi } from '../../src/orchestration/setup/gitlab-ci.js';
import { runInit } from '../../src/orchestration/setup/project-initialization.js';
import { runInstallCiCommand } from '../../src/orchestration/cli/install-ci.js';

function repository(context) {
  const directory = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(path.join(directory, 'doctor-workspace-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'workspace', scripts: {} }));
  return root;
}

function writeJson(root, file, value) {
  writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
}

function workspaceFixture(context, { guardedBuild = false, oneChild = false } = {}) {
  const root = repository(context);
  const ids = oneChild ? ['api'] : ['web', 'api'];
  writeJson(root, 'repo-guard.config.json', {
    version: 2,
    projects: ids.map((id) => ({ id, root: `apps/${id}` })),
    repository: { dependencyPolicy: { enabled: false } },
    reporting: { notification: { enabled: false } },
  });
  for (const id of ids) {
    mkdirSync(path.join(root, `apps/${id}`), { recursive: true });
    writeJson(root, `apps/${id}/package.json`, {
      name: id,
      scripts: { [`build:${id}`]: 'node build.js', [`typecheck:${id}`]: 'node types.js' },
    });
    writeJson(root, `apps/${id}/repo-guard.config.json`, {
      version: 2,
      project: { id, role: id === 'api' ? 'backend' : 'frontend', stack: 'node', preset: id === 'api' ? 'node-javascript' : 'vue-javascript' },
      checks: {
        eslint: { enabled: false }, prettier: { enabled: false }, stylelint: { enabled: false },
        typeCheck: { enabled: true, script: `typecheck:${id}` },
        build: { enabled: true, script: `build:${id}` },
        coverage: { reportsDirectory: `coverage-${id}` },
        ...(guardedBuild ? { mutationTest: { enabled: false, guardedBuilds: [{ script: `build:${id}`, packageScript: 'guard:build:release' }] } } : {}),
      },
    });
  }
  return root;
}

function capture(context) {
  const lines = [];
  context.mock.method(console, 'log', (...messages) => lines.push(messages.join(' ')));
  context.mock.method(console, 'error', (...messages) => lines.push(messages.join(' ')));
  return lines;
}

test('doctor 按显式应用目录检查构建和类型脚本，后端不执行 Vue 设置检查', async (context) => {
  const root = workspaceFixture(context);
  const lines = capture(context);
  assert.deepEqual(repairRepository(root).repairErrors, []);
  assert.equal(await runDoctor(root), 0, lines.join('\n'));
  const output = lines.join('\n');
  assert.match(output, /应用 api：构建门禁（脚本=build:api/);
  assert.match(output, /应用 web：构建门禁（脚本=build:web/);
  assert.doesNotMatch(output, /应用 api：Vue|应用 api：Lighthouse/);
  assert.match(readFileSync(path.join(root, 'apps/api/.gitignore'), 'utf8'), /coverage-api\//);
  assert.match(readFileSync(path.join(root, 'apps/web/.gitignore'), 'utf8'), /coverage-web\//);
});

test('根目录应用的初始化、修复、安装 CI 与 Doctor 使用同一份应用规范', async (context) => {
  const root = repository(context);
  const lines = capture(context);
  const manifest = { name: 'workspace', version: '1.0.0', devDependencies: { '@cxyi7/repo-guard': '2.0.0' } };
  writeJson(root, 'package.json', manifest);
  writeJson(root, 'package-lock.json', { name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { '': manifest } });
  writeJson(root, 'repo-guard.config.json', {
    version: 2, projects: [{ id: 'api', root: '.', config: 'guard.project.json' }],
    repository: { dependencyPolicy: { enabled: false } },
    reporting: { notification: { enabled: false } },
  });
  writeJson(root, 'guard.project.json', {
    version: 2, project: { id: 'api', role: 'backend', stack: 'node', preset: 'node-javascript' },
    checks: { eslint: { enabled: false }, prettier: { enabled: false } },
  });
  assert.equal(runInit(root), 0);
  assert.match(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /node-javascript/);
  assert.equal(await runDoctor(root), 0, lines.join('\n'));
  assert.deepEqual(repairRepository(root).repairErrors, []);
  assert.equal(await runDoctor(root), 0, lines.join('\n'));
  assert.equal(runInstallCiCommand(root, { provider: 'gitlab', profile: 'policy' }), 0);
  assert.match(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /node-javascript/);
  assert.equal(await runDoctor(root, { ci: true }), 0, lines.join('\n'));
});

test('doctor --project 只检查所选应用，但公共配置与根规范仍检查', async (context) => {
  const root = workspaceFixture(context);
  const lines = capture(context);
  assert.deepEqual(repairRepository(root).repairErrors, []);
  writeJson(root, 'apps/web/package.json', { name: 'web', scripts: {} });
  assert.equal(await runDoctor(root, { projectId: 'api' }), 0, lines.join('\n'));
  assert.equal(await runDoctor(root), 1);
  assert.match(lines.join('\n'), /应用 web：构建门禁要求/);
});

test('doctor --fix 不创建缺失配置、不猜测身份，也不修改旧版配置', (context) => {
  const root = repository(context);
  capture(context);
  const missing = repairRepository(root);
  assert.match(missing.repairErrors.join('\n'), /显式声明项目/);
  assert.equal(existsSync(path.join(root, 'repo-guard.config.json')), false);
  assert.equal(existsSync(path.join(root, '.githooks')), false);
  const legacy = '{"version":1,"rules":[]}\n';
  writeFileSync(path.join(root, 'repo-guard.config.json'), legacy);
  assert.match(repairRepository(root).repairErrors.join('\n'), /配置版本 1/);
  assert.equal(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'), legacy);
  assert.equal(existsSync(path.join(root, '.githooks')), false);
});

test('单个子应用仍同步仓库和应用规范，受保护构建脚本带显式项目', async (context) => {
  const root = workspaceFixture(context, { oneChild: true, guardedBuild: true });
  const lines = capture(context);
  assert.deepEqual(repairRepository(root).repairErrors, []);
  assert.equal(existsSync(path.join(root, 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(root, 'apps/api/AGENTS.md')), true);
  const manifest = JSON.parse(readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));
  assert.equal(manifest.scripts['guard:build:release'], 'repo-guard guarded-build build:api --project api');
  assert.equal(manifest.scripts.prepare, undefined);
  assert.equal(await runDoctor(root), 0, lines.join('\n'));
});

test('未知项目选择在修复写入前失败', (context) => {
  const root = workspaceFixture(context);
  const result = repairRepository(root, { projectId: 'missing' });
  assert.match(result.repairErrors.join('\n'), /未配置项目/);
  assert.equal(existsSync(path.join(root, 'AGENTS.md')), false);
  assert.equal(existsSync(path.join(root, '.githooks')), false);
});

test('多应用仓库的质量 CI 安装只更新公共配置且不生成部署作业', (context) => {
  const root = workspaceFixture(context);
  const result = installGitLabCi(root, { profile: 'full' });
  assert.equal(result.integrated, true);
  assert.equal(result.pipelineEnabled, false);
  const rootConfig = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
  assert.equal(rootConfig.ci.profile, 'full');
  assert.equal(rootConfig.ci.pipeline, undefined);
  const pipeline = readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8');
  assert.doesNotMatch(pipeline, /repo_guard_deploy|ci:deploy/);
});
