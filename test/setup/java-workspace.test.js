import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { inspectAgentPolicies } from '../../src/policies/agent-policies.js';
import { runDoctor } from '../../src/orchestration/doctor/runner.js';
import { installHooks } from '../../src/orchestration/setup/hook-installer.js';
import { runInit } from '../../src/orchestration/setup/project-initialization.js';
import { repairRepository } from '../../src/orchestration/setup/repository-repair.js';

const javaProject = { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' };

function fixture(context) {
  const directory = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(path.join(directory, 'java-workspace-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const lines = [];
  context.mock.method(console, 'log', (...messages) => lines.push(messages.join(' ')));
  context.mock.method(console, 'error', (...messages) => lines.push(messages.join(' ')));
  return { root, lines };
}

function writeJson(root, file, value) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

test('纯 Java 无 package.json 时可初始化、修复和诊断，宿主工具由已有入口提供', async (context) => {
  const { root, lines } = fixture(context);
  assert.equal(runInit(root, { project: javaProject }), 0);
  assert.equal(existsSync(path.join(root, 'package.json')), false);
  assert.equal(existsSync(path.join(root, 'pom.xml')), false);
  const document = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
  document.reporting.notification.enabled = false;
  writeJson(root, 'repo-guard.config.json', document);
  const hooks = installHooks({ cwd: root, updatePackageScripts: true });
  assert.equal(hooks.skipped, false);
  assert.match(readFileSync(path.join(root, '.githooks/pre-commit'), 'utf8'), /command -v repo-guard/);
  assert.deepEqual(repairRepository(root).repairErrors, []);
  assert.equal(await runDoctor(root), 0, lines.join('\n'));
  assert.equal(existsSync(path.join(root, 'package.json')), false);
  const config = loadWorkspace(root).projects[0].config;
  assert.equal(inspectAgentPolicies(root, config).changed, false);
  const policies = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(policies, /Java\/Maven 工程检查/);
  assert.match(policies, /Java 检查默认关闭/);
  assert.match(policies, /通过 lint-staged.*暂存 Java 文件格式化，然后只读复核格式/);
  assert.match(policies, /保留部分暂存与未暂存内容/);
  assert.match(policies, /尚未提供 Java 运维部署适配/);
  assert.doesNotMatch(policies, /ESLint|Prettier|Stylelint|Vitest|eval 或 Function|TypeScript JSDoc/);
});

test('Node 与 Java 共存时分别生成规范且 Doctor 不要求 Java 的 npm 清单', async (context) => {
  const { root, lines } = fixture(context);
  writeJson(root, 'package.json', { name: 'workspace', scripts: {} });
  writeJson(root, 'repo-guard.config.json', {
    version: 2, projects: [{ id: 'web', root: 'apps/web' }, { id: 'api', root: 'apps/api' }],
    reporting: { notification: { enabled: false } },
  });
  writeJson(root, 'apps/web/package.json', { name: 'web', scripts: {} });
  writeJson(root, 'apps/web/repo-guard.config.json', {
    version: 2, project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' },
    checks: { eslint: { enabled: false }, prettier: { enabled: false } },
    repository: { dependencyPolicy: { enabled: false } },
  });
  writeJson(root, 'apps/api/repo-guard.config.json', { version: 2, project: javaProject });
  assert.equal(runInit(root), 0);
  assert.equal(await runDoctor(root), 0, lines.join('\n'));
  assert.equal(existsSync(path.join(root, 'apps/api/package.json')), false);
  assert.match(readFileSync(path.join(root, 'apps/web/AGENTS.md'), 'utf8'), /Vue 模板/);
  assert.doesNotMatch(readFileSync(path.join(root, 'apps/api/AGENTS.md'), 'utf8'), /Vue 模板|ESLint|Vitest/);
  assert.equal(loadWorkspace(root).projects.find(({ id }) => id === 'api').config.repository.dependencyPolicy.enabled, false);
});
