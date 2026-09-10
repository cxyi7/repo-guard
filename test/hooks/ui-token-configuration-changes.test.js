import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { createChangeSet } from '../../src/core/capability/gate-context.js';
import { uiTokenGate } from '../../src/gates/quality/ui-token-gate.js';
import { collectStagedChanges } from '../../src/git/change-collection.js';
import { runWorkspaceQualityExecution } from '../../src/orchestration/pre-commit/quality-runner.js';
import { createWorkspaceTargets } from '../../src/orchestration/workspace/targets.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';
import { tokenManifest } from '../helpers/ui-tokens.js';

const WEB_CONFIG = 'apps/web/team-rules.json';
const API_CONFIG = 'apps/api/team-rules.json';
const ROOT_CONFIG = 'repo-guard.config.json';
const CSS_FILE = 'apps/web/src/card.css';
const CSS_CONTENT = '.card { padding: 12px; }\n';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function projectDocument(id) {
  return {
    version: 2,
    project: {
      id,
      role: id === 'web' ? 'frontend' : 'backend',
      stack: 'node',
      preset: id === 'web' ? 'vue-javascript' : 'node-javascript',
    },
    checks: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      stylelint: { enabled: false },
      filePlacement: { enabled: false },
      maxFileLines: { enabled: false },
      pathNaming: { enabled: false },
      ...(id === 'web' ? { uiTokens: { enabled: true, languages: ['css'] } } : {}),
    },
    repository: { dependencyPolicy: { enabled: false } },
  };
}

function fixture(context) {
  const files = {
    'package.json': json({ name: 'ui-token-workspace', private: true, type: 'module' }),
    [ROOT_CONFIG]: json({
      version: 2,
      projects: ['web', 'api'].map((id) => ({
        id, root: `apps/${id}`, config: 'team-rules.json',
      })),
      reporting: { notification: { enabled: false } },
    }),
    [WEB_CONFIG]: json(projectDocument('web')),
    [API_CONFIG]: json(projectDocument('api')),
    'apps/web/package.json': json({ name: 'web', type: 'module' }),
    'apps/api/package.json': json({ name: 'api', type: 'module' }),
    'apps/web/stylelint.config.cjs': 'module.exports = { rules: {} };\n',
    'apps/web/design/tokens.json': '{}\n',
    'apps/web/ui-tokens.manifest.json': json(tokenManifest()),
    [CSS_FILE]: CSS_CONTENT,
    'apps/api/src/server.js': 'export const ready = true;\n',
  };
  return createGitProjectFixture(context, files);
}

function quiet(context) {
  const messages = [];
  for (const method of ['log', 'error']) {
    context.mock.method(console, method, (...values) => messages.push(values.join(' ')));
  }
  return messages;
}

function stagedTargets(workspace, environment = 'pre-commit') {
  return createWorkspaceTargets({
    workspace,
    environment,
    changes: createChangeSet({ source: 'staged', changes: collectStagedChanges(workspace.root) }),
    files: [],
  });
}

for (const configFile of [WEB_CONFIG, ROOT_CONFIG]) {
  test(`只暂存 ${configFile} 仍复查未更改样式并阻断原始值`, async (context) => {
    const root = fixture(context);
    const messages = quiet(context);
    writeProjectFile(root, configFile, `${readFileSync(path.join(root, configFile), 'utf8')}\n`);
    fixtureGit(root, ['add', configFile]);
    const workspace = loadWorkspace(root);
    const web = stagedTargets(workspace).projects.find(({ project }) => project.id === 'web');
    assert.equal(web.configurationChanged, true);
    assert.deepEqual(web.files, []);
    assert.deepEqual(uiTokenGate.plan(web).files.map(({ relative }) => relative), ['src/card.css']);
    assert.deepEqual(collectStagedChanges(root).map(({ path: file }) => file), [configFile]);

    const execution = await runWorkspaceQualityExecution(workspace, []);
    assert.notEqual(execution.exitCode, 0, messages.join('\n'));
    assert.equal(execution.decisiveResult.gateId, 'quality.ui-tokens');
    assert.equal(execution.decisiveResult.status, 'violation');
    assert.deepEqual(execution.decisiveResult.findings.map(({ ruleId, location }) => (
      [ruleId, location.path]
    )), [['ui-token/raw-value', 'src/card.css']]);
    assert.equal(readFileSync(path.join(root, CSS_FILE), 'utf8'), CSS_CONTENT);
    assert.equal(fixtureGit(root, ['show', `:${CSS_FILE}`]), CSS_CONTENT.trim());
  });
}

test('只修改后端配置不会复查未受影响前端的样式', async (context) => {
  const root = fixture(context);
  quiet(context);
  writeProjectFile(root, API_CONFIG, `${readFileSync(path.join(root, API_CONFIG), 'utf8')}\n`);
  fixtureGit(root, ['add', API_CONFIG]);
  const workspace = loadWorkspace(root);
  const web = stagedTargets(workspace, 'ci-policy').projects.find(({ project }) => project.id === 'web');
  assert.equal(web.configurationChanged, false);
  assert.deepEqual(uiTokenGate.plan(web).files, []);
  assert.equal(stagedTargets(workspace).projects.some(({ project }) => project.id === 'web'), false);
  const execution = await runWorkspaceQualityExecution(workspace, []);
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.results.some(({ gateId }) => gateId === 'quality.ui-tokens'), false);
});

for (const previousConfig of [WEB_CONFIG, ROOT_CONFIG]) {
  test(`配置重命名来源 ${previousConfig} 仍触发前端样式复查`, (context) => {
    const root = fixture(context);
    const workspace = loadWorkspace(root);
    const targets = createWorkspaceTargets({
      workspace,
      environment: 'pre-commit',
      changes: createChangeSet({
        source: 'rename-regression',
        changes: [{ status: 'R100', oldPath: previousConfig, path: `${previousConfig}.saved` }],
      }),
      files: [],
    });
    const web = targets.projects.find(({ project }) => project.id === 'web');
    assert.equal(web.configurationChanged, true);
    assert.deepEqual(uiTokenGate.plan(web).files.map(({ relative }) => relative), ['src/card.css']);
  });
}

test('同目录未声明的默认配置文件名不触发自定义配置应用的全量复查', (context) => {
  const root = fixture(context);
  const workspace = loadWorkspace(root);
  const targets = createWorkspaceTargets({
    workspace,
    environment: 'pre-commit',
    changes: createChangeSet({
      source: 'unrelated-file-regression',
      changes: [{ status: 'M', path: 'apps/web/repo-guard.config.json' }],
    }),
    files: [],
  });
  const web = targets.projects.find(({ project }) => project.id === 'web');
  assert.equal(web.configurationChanged, false);
  assert.deepEqual(uiTokenGate.plan(web).files, []);
});
