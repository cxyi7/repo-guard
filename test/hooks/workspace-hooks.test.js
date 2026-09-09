import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { createChangeSet } from '../../src/core/capability/gate-context.js';
import { createGateResult } from '../../src/core/result/gate-result.js';
import { orchestratePlan } from '../../src/orchestration/orchestrator.js';
import { runQualityGate } from '../../src/orchestration/pre-commit/lint-staged-gate.js';
import { runPreCommit } from '../../src/orchestration/pre-commit/runner.js';
import { runWorkspaceQualityExecution } from '../../src/orchestration/pre-commit/quality-runner.js';
import { preCommitPlan } from '../../src/orchestration/pre-commit/protected-plan.js';
import { resolvePushConfig } from '../../src/orchestration/pre-push/push-configuration.js';
import { loadStagedWorkspace } from '../../src/orchestration/workspace/configuration-snapshot.js';
import {
  createWorkspaceTargets,
  scopeProjectChanges,
  workspaceStepTargets,
} from '../../src/orchestration/workspace/targets.js';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function writeJson(root, file, value) {
  writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(context, { tools = false, build = false } = {}) {
  const directory = path.join(process.cwd(), 'test', '.tmp');
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(path.join(directory, 'workspace-hooks-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.name', '工程检查测试']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  writeJson(root, 'package.json', { name: 'workspace', type: 'module' });
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  const rootConfig = {
    version: 2,
    projects: ['web', 'api'].map((id) => ({ id, root: `apps/${id}` })),
    repository: {
      dependencyPolicy: { enabled: false },
      rules: [
        { pattern: 'critical.txt', category: '必要内容', level: 'block' },
      ],
    },
    reporting: { notification: { enabled: false } },
  };
  writeJson(root, 'repo-guard.config.json', rootConfig);
  for (const id of ['web', 'api']) {
    mkdirSync(path.join(root, `apps/${id}/src`), { recursive: true });
    writeJson(root, `apps/${id}/package.json`, {
      name: id,
      type: 'module',
      scripts: { build: 'node build.js' },
    });
    writeJson(root, `apps/${id}/repo-guard.config.json`, {
      version: 2,
      project: {
        id,
        role: id === 'api' ? 'backend' : 'frontend',
        stack: 'node',
        preset: id === 'api' ? 'node-javascript' : 'vue-javascript',
      },
      checks: {
        eslint: { enabled: tools, preset: false, pattern: '*.js', fix: true },
        prettier: { enabled: tools, pattern: '*.js', requireConfig: true },
        stylelint: { enabled: false },
        build: { enabled: build },
        filePlacement: { enabled: false },
        maxFileLines: { enabled: false },
      },
    });
    writeFileSync(
      path.join(root, `apps/${id}/eslint.config.mjs`),
      'export default [{ files: ["**/*.js"], rules: { semi: ["error", "always"] } }];\n',
    );
    writeJson(root, `apps/${id}/.prettierrc.json`, {
      semi: true,
      singleQuote: true,
    });
    writeFileSync(
      path.join(root, `apps/${id}/src/value.js`),
      'export const value = 1;\n',
    );
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'test: 初始化前后端检查样例']);
  return { root, rootConfig, base: git(root, ['rev-parse', 'HEAD']).trim() };
}

function quiet(context) {
  const messages = [];
  context.mock.method(console, 'log', (...items) =>
    messages.push(items.join(' ')),
  );
  context.mock.method(console, 'error', (...items) =>
    messages.push(items.join(' ')),
  );
  return messages;
}

test('多应用的固定步骤按同一步骤轮流执行，受保护文件只在仓库最终检查', async (context) => {
  const { root } = fixture(context);
  const targets = createWorkspaceTargets({
    workspace: loadWorkspace(root),
    environment: 'pre-commit',
    changes: createChangeSet({ source: 'test', changes: [] }),
  });
  const calls = [];
  const registry = {
    get: (id) => ({
      id,
      defaultTimeoutMs: 10000,
      inspectSetup: () => ({ status: 'ready', summary: '配置有效' }),
      plan: () => ({}),
      run: (stepContext) => {
        calls.push(
          `${stepContext.step.id}:${stepContext.project?.id ?? 'repository'}`,
        );
        return createGateResult({
          gateId: id,
          status: 'passed',
          summary: '检查通过',
        });
      },
    }),
  };
  const result = await orchestratePlan({
    plan: preCommitPlan,
    registry,
    context: targets.repository,
    contextsForStep: ({ step }) => workspaceStepTargets(targets, step),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.slice(0, 10), [
    'quality.stylelint-fix:web',
    'quality.stylelint-fix:api',
    'quality.eslint-fix:web',
    'quality.eslint-fix:api',
    'quality.prettier:web',
    'quality.prettier:api',
    'quality.stylelint-verify:web',
    'quality.stylelint-verify:api',
    'quality.eslint-verify:web',
    'quality.eslint-verify:api',
  ]);
  assert.equal(calls.at(-1), 'repository.protected-files:repository');
  assert.equal(
    calls.filter((call) => call.startsWith('repository.protected-files'))
      .length,
    1,
  );
  assert.equal(
    calls.some((call) => /vue.*:api/.test(call)),
    false,
  );
});

test('应用失败不会被另一个应用成功覆盖，前序结果按应用隔离', async (context) => {
  const { root } = fixture(context);
  const targets = createWorkspaceTargets({
    workspace: loadWorkspace(root),
    environment: 'pre-push',
    changes: createChangeSet({ source: 'test', changes: [] }),
  });
  const prior = [];
  const registry = {
    get: (id) => ({
      id,
      defaultTimeoutMs: 10000,
      inspectSetup: () => ({ status: 'ready', summary: '配置有效' }),
      plan: () => ({}),
      run: (stepContext) => {
        prior.push({
          id: stepContext.project.id,
          count: stepContext.priorResults.length,
        });
        return createGateResult({
          gateId: id,
          status: stepContext.project.id === 'web' ? 'violation' : 'passed',
          summary: '验证结果',
        });
      },
    }),
  };
  const result = await orchestratePlan({
    plan: {
      id: 'workspace-check',
      steps: [{ id: 'quality.build', gateId: 'quality.build' }],
    },
    registry,
    context: targets.repository,
    contextsForStep: () => targets.projects,
  });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.status, 'violation');
  assert.deepEqual(prior, [
    { id: 'web', count: 0 },
    { id: 'api', count: 0 },
  ]);
});

test('索引同时读取根清单和子应用配置，不混入工作树中尚未暂存的规则', (context) => {
  const { root, rootConfig } = fixture(context);
  const child = 'apps/api/repo-guard.config.json';
  const committed = JSON.parse(readFileSync(path.join(root, child), 'utf8'));
  writeJson(root, child, {
    ...committed,
    checks: { ...committed.checks, eslint: { enabled: true, preset: false } },
  });
  git(root, ['add', child]);
  writeJson(root, child, {
    ...committed,
    checks: { ...committed.checks, eslint: { enabled: false } },
  });
  writeJson(root, 'repo-guard.config.json', {
    ...rootConfig,
    projects: [rootConfig.projects[0]],
  });
  const workspace = loadStagedWorkspace(root);
  assert.deepEqual(
    workspace.projects.map((project) => project.id),
    ['web', 'api'],
  );
  assert.equal(
    workspace.projects.find((project) => project.id === 'api').config.checks
      .eslint.enabled,
    true,
  );
});

test('暂存删除已跟踪的根配置后，不接受工作树恢复的放宽配置', (context) => {
  const { root, rootConfig } = fixture(context);
  git(root, ['rm', '--', 'repo-guard.config.json']);
  writeJson(root, 'repo-guard.config.json', {
    ...rootConfig,
    repository: { rules: [] },
  });
  assert.throws(() => loadStagedWorkspace(root), /配置|快照/);
});

test('根清单中的子应用配置从索引删除时必须阻断', (context) => {
  const { root } = fixture(context);
  const file = 'apps/api/repo-guard.config.json';
  const original = readFileSync(path.join(root, file), 'utf8');
  git(root, ['rm', '--', file]);
  writeFileSync(path.join(root, file), original);
  assert.throws(() => loadStagedWorkspace(root), /配置快照中缺少/);
});

test('真实推送拒绝脏工作树、非检出版本及多版本混合，纯删除引用可跳过', (context) => {
  const { root, base } = fixture(context, { build: true });
  const protocol = (head, remote = base) =>
    `refs/heads/main ${head} refs/heads/main ${remote}\n`;
  writeFileSync(path.join(root, 'local-only.txt'), '尚未提交');
  assert.throws(() => resolvePushConfig(root, protocol(base)), /保持干净/);
  git(root, ['add', 'local-only.txt']);
  git(root, ['commit', '-m', 'test: 新增待推送内容']);
  const next = git(root, ['rev-parse', 'HEAD']).trim();
  assert.throws(
    () => resolvePushConfig(root, protocol(base)),
    /当前检出的 HEAD/,
  );
  assert.throws(
    () =>
      resolvePushConfig(
        root,
        `${protocol(next)}refs/heads/other ${base} refs/heads/other ${base}\n`,
      ),
    /多个不同提交/,
  );
  assert.equal(resolvePushConfig(root, protocol('0'.repeat(40))).skip, true);
});

test('已接入仓库不能通过推送删除根配置跳过质量门禁', (context) => {
  const { root, base } = fixture(context, { build: true });
  git(root, ['rm', '--', 'repo-guard.config.json']);
  git(root, ['commit', '-m', 'test: 删除配置样例']);
  const next = git(root, ['rev-parse', 'HEAD']).trim();
  assert.throws(
    () =>
      resolvePushConfig(
        root,
        `refs/heads/main ${next} refs/heads/main ${base}\n`,
      ),
    /配置/,
  );
});

test('跨应用重命名在原应用显示删除、目标应用显示新增，范围不交叉', () => {
  const changes = [
    {
      status: 'R100',
      oldPath: 'apps/web/src/shared.js',
      path: 'apps/api/src/shared.js',
    },
  ];
  assert.deepEqual(scopeProjectChanges(changes, 'apps/web'), [
    { status: 'D', path: 'src/shared.js', oldPath: null },
  ]);
  assert.deepEqual(scopeProjectChanges(changes, 'apps/api'), [
    { status: 'A', path: 'src/shared.js', oldPath: null },
  ]);
});

test('同样的 Vue 文件只对明确声明的前端运行 Vue 门禁', async (context) => {
  const { root } = fixture(context);
  quiet(context);
  const content = '<template><input placeholder="名称"></template>\n';
  const apiFile = path.join(root, 'apps/api/src/sample.vue');
  writeFileSync(apiFile, content);
  git(root, ['add', 'apps/api/src/sample.vue']);
  const backend = await runWorkspaceQualityExecution(loadWorkspace(root), [
    apiFile,
  ]);
  assert.equal(backend.exitCode, 0);
  const webFile = path.join(root, 'apps/web/src/sample.vue');
  writeFileSync(webFile, content);
  git(root, ['add', 'apps/web/src/sample.vue']);
  const frontend = await runWorkspaceQualityExecution(loadWorkspace(root), [
    webFile,
  ]);
  assert.notEqual(frontend.exitCode, 0);
  assert.equal(frontend.decisiveResult.gateId, 'accessibility.vue-form-label');
});

test('关闭 Prettier 时 ESLint 修复之后仍执行独立只读复核', async (context) => {
  const { root } = fixture(context, { tools: true });
  const messages = quiet(context);
  const configFile = 'apps/api/repo-guard.config.json';
  const document = JSON.parse(
    readFileSync(path.join(root, configFile), 'utf8'),
  );
  document.checks.prettier = { enabled: false };
  writeJson(root, configFile, document);
  const source = path.join(root, 'apps/api/src/value.js');
  writeFileSync(source, 'export const value = 2\n');
  git(root, ['add', configFile, 'apps/api/src/value.js']);
  const result = await runWorkspaceQualityExecution(loadWorkspace(root), [
    source,
  ]);
  assert.equal(result.exitCode, 0, messages.join('\n'));
  assert.match(messages.join('\n'), /通过 {2}api \/ quality\.eslint-verify/);
  assert.equal(readFileSync(source, 'utf8'), 'export const value = 2;\n');
});

test('一次 lint-staged 隔离两个应用的部分暂存内容并保留未暂存修改', async (context) => {
  const { root } = fixture(context, { tools: true });
  const messages = quiet(context);
  for (const id of ['web', 'api']) {
    const file = `apps/${id}/src/value.js`;
    writeFileSync(path.join(root, file), 'export const value = 2\n');
    git(root, ['add', file]);
    writeFileSync(
      path.join(root, file),
      `export const value = 2\nexport const local${id} = true\n`,
    );
  }
  assert.equal(await runQualityGate({ cwd: root }), 0, messages.join('\n'));
  for (const id of ['web', 'api']) {
    const file = `apps/${id}/src/value.js`;
    assert.equal(git(root, ['show', `:${file}`]), 'export const value = 2;\n');
    assert.match(
      readFileSync(path.join(root, file), 'utf8'),
      new RegExp(`local${id}`),
    );
  }
});

test('任一应用质量失败后恢复两个应用的索引和工作树', async (context) => {
  const { root } = fixture(context, { tools: true });
  quiet(context);
  const contents = {
    web: 'export const value = 2\n',
    api: 'export const = ;\n',
  };
  for (const [id, content] of Object.entries(contents)) {
    const file = `apps/${id}/src/value.js`;
    writeFileSync(path.join(root, file), content);
    git(root, ['add', file]);
    writeFileSync(
      path.join(root, file),
      `${content}// 尚未暂存的 ${id} 修改\n`,
    );
  }
  assert.equal(await runQualityGate({ cwd: root }), 1);
  for (const [id, content] of Object.entries(contents)) {
    const file = `apps/${id}/src/value.js`;
    assert.equal(git(root, ['show', `:${file}`]), content);
    assert.equal(
      readFileSync(path.join(root, file), 'utf8'),
      `${content}// 尚未暂存的 ${id} 修改\n`,
    );
  }
});

test('真实多应用 pre-commit 在完成格式修复后仍阻断仓库受保护文件', async (context) => {
  const { root } = fixture(context, { tools: true });
  const messages = quiet(context);
  writeFileSync(
    path.join(root, 'apps/api/src/value.js'),
    'export const value = 2\n',
  );
  writeFileSync(path.join(root, 'critical.txt'), '不能随意变更的必要内容\n');
  git(root, ['add', 'apps/api/src/value.js', 'critical.txt']);
  assert.equal(await runPreCommit(root), 1, messages.join('\n'));
  assert.equal(
    git(root, ['show', ':apps/api/src/value.js']),
    'export const value = 2;\n',
  );
  assert.match(messages.join('\n'), /critical.txt/);
  assert.match(messages.join('\n'), /repository.protected-files/);
});
