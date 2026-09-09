import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadConfig,
  loadWorkspace,
} from '../../src/config/configuration-loader.js';
import {
  createProjectDocument,
  normalizeProjectDocument,
  serializeProjectConfig,
} from '../../src/config/project-configuration.js';

const backend = {
  id: 'api',
  role: 'backend',
  stack: 'node',
  preset: 'node-typescript',
};
const frontend = {
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-typescript',
};
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-v2-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, document, name = 'repo-guard.config.json') {
  writeFileSync(path.join(root, name), JSON.stringify(document));
}

test('Node 默认覆盖后端源码且不启用前端专用能力', () => {
  const document = createProjectDocument(backend);
  assert.equal(document.version, 2);
  assert.equal(document.checks.eslint.enabled, true);
  assert.equal(document.checks.prettier.enabled, true);
  assert.equal(document.checks.stylelint.enabled, false);
  assert.deepEqual(document.checks.unitTest.sourcePatterns, [
    'src/**/*.{js,mjs,cjs,ts,mts,cts}',
  ]);
  assert.equal(document.checks.componentInteraction.enabled, false);
  assert.equal(document.checks.lighthouse.enabled, false);
  assert.deepEqual(
    serializeProjectConfig(normalizeProjectDocument(document)),
    document,
  );
});

test('Node 稀疏配置只修改开关时保留后端路径，显式路径仍可覆盖预设', () => {
  const document = {
    version: 2,
    project: backend,
    checks: {
      eslint: { enabled: true },
      prettier: { enabled: true },
      unitTest: { enabled: true },
    },
  };
  const config = normalizeProjectDocument(document);
  assert.deepEqual(config.checks.unitTest.sourcePatterns, [
    'src/**/*.{js,mjs,cjs,ts,mts,cts}',
  ]);
  assert.ok(config.checks.eslint.pattern.includes('mts'));
  assert.ok(!config.checks.eslint.pattern.includes('vue'));
  assert.ok(!config.checks.prettier.pattern.includes('vue'));
  assert.ok(!config.checks.unitTest.exclusions.includes('src/main.*'));
  document.checks.unitTest.sourcePatterns = ['server/**/*.ts'];
  assert.deepEqual(
    normalizeProjectDocument(document).checks.unitTest.sourcePatterns,
    ['server/**/*.ts'],
  );
});

test('必须明确身份并拒绝未知字段、错误方案及未实现 Java 检查', () => {
  for (const document of [
    { version: 2 },
    { version: 2, project: { ...backend, role: 'frontend' } },
    { version: 2, project: { ...backend, preset: 'constructor' } },
    { version: 2, project: backend, typo: {} },
    {
      version: 2,
      project: backend,
      checks: { apiContract: { enabled: true } },
    },
    {
      version: 2,
      project: backend,
      checks: { unitTest: { coverage: { enabled: true } } },
    },
    { version: 2, project: backend, ci: { pipeline: { enabled: false } } },
    {
      version: 2,
      project: backend,
      checks: { componentInteraction: { enabled: true } },
    },
  ])
    assert.throws(() => normalizeProjectDocument(document));
  assert.throws(
    () =>
      normalizeProjectDocument({
        version: 2,
        project: {
          id: 'java',
          role: 'backend',
          stack: 'java',
          preset: 'java-maven',
        },
      }),
    { code: 'project/stack-not-supported' },
  );
});

test('检查子项不依赖 JSON 属性顺序且未知子属性继续拒绝', () => {
  const config = normalizeProjectDocument({
    version: 2,
    project: backend,
    checks: {
      coverage: { enabled: true },
      unitTest: { enabled: true },
    },
  });
  assert.equal(config.checks.coverage.enabled, true);
  assert.throws(() =>
    normalizeProjectDocument({
      version: 2,
      project: backend,
      checks: {
        eslint: { enabled: true, pretendPassing: true },
      },
    }),
  );
});

test('磁盘旧版本明确拒绝执行，不转换保护规则、阈值或运维配置', (t) => {
  const root = fixture(t);
  const old = {
    version: 1,
    rules: [
      { pattern: 'src/critical.js', category: '必要实现', level: 'block' },
    ],
    exclusions: ['docs/**'],
    preCommit: {
      maxFileLines: { rules: [{ pattern: '**/*.js', maxLines: 99 }] },
    },
    ci: { pipeline: { enabled: true, quickDeploy: true } },
  };
  write(root, old);
  const file = path.join(root, 'repo-guard.config.json');
  const original = readFileSync(file, 'utf8');
  assert.throws(() => loadConfig(root), { code: 'config/unsupported-version' });
  assert.throws(() => normalizeProjectDocument(old), { code: 'config/unsupported-version' });
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('多应用隔离身份、继承仓库规则并要求明确选应用', (t) => {
  const root = fixture(t);
  for (const project of [backend, frontend]) {
    mkdirSync(path.join(root, project.id));
    write(path.join(root, project.id), { version: 2, project });
  }
  write(root, {
    version: 2,
    projects: [
      { id: 'api', root: 'api' },
      { id: 'web', root: 'web' },
    ],
    repository: {
      rules: [{ pattern: '**/package.json', category: '依赖', level: 'block' }],
    },
  });
  const workspace = loadWorkspace(root);
  assert.equal(workspace.projects.length, 2);
  assert.equal(workspace.repositoryConfig.project, undefined);
  assert.equal(
    loadConfig(root, { repositoryOnly: true }).repository.rules[0].level,
    'block',
  );
  assert.equal(loadConfig(root, { projectId: 'api' }).project.role, 'backend');
  assert.throws(() => loadConfig(root), { code: 'project/selection-required' });
  assert.throws(() => loadConfig(root, { projectId: 'missing' }), {
    code: 'project/not-found',
  });
  write(path.join(root, 'api'), {
    version: 2,
    project: backend,
    repository: { rules: [] },
  });
  assert.throws(() => loadWorkspace(root), /子应用不得覆盖/);
});

test('所有配置从同一快照读取，拒绝目录越界和项目归属重叠', (t) => {
  const root = fixture(t);
  const snapshot = new Map([
    [
      'repo-guard.config.json',
      { version: 2, projects: [{ id: 'api', root: 'apps/api' }] },
    ],
    ['apps/api/repo-guard.config.json', { version: 2, project: backend }],
  ]);
  const readDocument = (relative) => snapshot.get(relative);
  assert.equal(loadWorkspace(root, { readDocument }).projects[0].id, 'api');
  for (const invalid of [
    '../outside',
    'apps/../outside',
    'C:/outside',
    '/outside',
    'apps\\api',
  ]) {
    snapshot.get('repo-guard.config.json').projects[0].root = invalid;
    assert.throws(() => loadWorkspace(root, { readDocument }));
  }
  snapshot.set('repo-guard.config.json', {
    version: 2,
    projects: [
      { id: 'api', root: 'apps/api' },
      { id: 'web', root: 'apps/api/web' },
    ],
  });
  assert.throws(() => loadWorkspace(root, { readDocument }), /目录重叠/);
});

test('快照模式仅允许暂缺路径，不能把已有文件当成应用目录', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'api'), '已有普通文件');
  const readDocument = (file) =>
    file === 'repo-guard.config.json'
      ? { version: 2, projects: [{ id: 'api', root: 'api' }] }
      : { version: 2, project: backend };
  assert.throws(() => loadWorkspace(root, { readDocument }), /必须指向目录/);
});

test('快照不存在的子目录也不能通过已有父目录链接逃出仓库', (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  symlinkSync(outside, path.join(root, 'linked'), 'junction');
  const readDocument = (file) =>
    file === 'repo-guard.config.json'
      ? { version: 2, projects: [{ id: 'api', root: 'linked/not-created' }] }
      : { version: 2, project: backend };
  assert.throws(
    () => loadWorkspace(root, { readDocument }),
    /目录联接不得指向所属目录之外/,
  );
});
