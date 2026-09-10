import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadWorkspace } from '../../src/config/configuration-loader.js';
import { runWorkspaceCi } from '../../src/orchestration/ci/workspace-runner.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';
import { tokenManifest } from '../helpers/ui-tokens.js';

const ROOT_CONFIG = 'repo-guard.config.json';
const WEB_CONFIG = 'apps/web/team-rules.json';
const CSS_FILE = 'apps/web/src/card.css';
const CSS_CONTENT = '.card { padding: 12px; }\n';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixture(context, changedFile) {
  const files = {
    '.gitignore': '**/reports/\nnode_modules/\n',
    'package.json': json({ name: 'ui-token-ci-workspace', private: true, type: 'module' }),
    [ROOT_CONFIG]: json({
      version: 2,
      projects: ['web', 'api'].map((id) => ({
        id, root: `apps/${id}`, config: 'team-rules.json',
      })),
      reporting: { notification: { enabled: false } },
      ci: { enabled: true, profile: 'policy', gatePolicy: { defaultMode: 'off' } },
    }),
    'apps/web/stylelint.config.cjs': 'module.exports = { rules: {} };\n',
    'apps/web/design/tokens.json': '{}\n',
    'apps/web/ui-tokens.manifest.json': json(tokenManifest()),
    [CSS_FILE]: CSS_CONTENT,
    'apps/api/src/server.js': 'export const ready = true;\n',
  };
  for (const id of ['web', 'api']) {
    files[`apps/${id}/package.json`] = json({ name: id, type: 'module' });
    files[`apps/${id}/team-rules.json`] = json({
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
        ...(id === 'web' ? { uiTokens: { enabled: true, languages: ['css'] } } : {}),
      },
      repository: { dependencyPolicy: { enabled: false } },
      ci: { gatePolicy: {
        defaultMode: 'off',
        gates: id === 'web'
          ? { 'quality.ui-tokens': { mode: 'enforce', scope: 'changed-files' } }
          : {},
      } },
    });
  }
  const root = createGitProjectFixture(context, files);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  writeProjectFile(root, changedFile, `${readFileSync(path.join(root, changedFile), 'utf8')}\n`);
  fixtureGit(root, ['add', changedFile]);
  fixtureGit(root, ['commit', '-m', 'test: 调整应用检查配置']);
  return { root, base, head: fixtureGit(root, ['rev-parse', 'HEAD']) };
}

for (const changedFile of [WEB_CONFIG, ROOT_CONFIG]) {
  test(`CI 增量范围只含 ${changedFile} 时仍报告未改动样式的 Token 违规`, async (context) => {
    const { root, base, head } = fixture(context, changedFile);
    const messages = [];
    for (const method of ['log', 'error']) {
      context.mock.method(console, method, (...values) => messages.push(values.join(' ')));
    }
    assert.equal(fixtureGit(root, ['diff', '--name-only', base, head]), changedFile);
    const workspace = loadWorkspace(root);
    assert.equal(workspace.projects.find(({ id }) => id === 'web')
      .config.ci.gatePolicy.gates['quality.ui-tokens'].scope, 'changed-files');

    const exitCode = await runWorkspaceCi({ workspace, options: { base, head, profile: 'policy', env: {} } });
    assert.notEqual(exitCode, 0, messages.join('\n'));
    const report = JSON.parse(readFileSync(path.join(root, 'reports/repo-guard.json'), 'utf8'));
    const web = report.targets.find(({ projectId }) => projectId === 'web');
    const step = web.report.steps.find(({ gateResult }) => gateResult?.gateId === 'quality.ui-tokens');
    assert.ok(step, JSON.stringify(web.report));
    assert.equal(step.gatePolicy.scope, 'changed-files');
    assert.equal(step.gateResult.status, 'violation');
    assert.deepEqual(step.gateResult.findings.map(({ ruleId, location }) => (
      [ruleId, location.path]
    )), [['ui-token/raw-value', 'src/card.css']]);
    assert.equal(step.gateResult.metrics.checkedFiles, 1);
    assert.equal(readFileSync(path.join(root, CSS_FILE), 'utf8'), CSS_CONTENT);

    const api = report.targets.find(({ projectId }) => projectId === 'api');
    if (changedFile === WEB_CONFIG) {
      assert.deepEqual(report.selectedProjects, ['web']);
      assert.equal(api, undefined);
    } else {
      assert.deepEqual(report.selectedProjects, ['web', 'api']);
      assert.equal(api.exitCode, 0);
      const apiTokenStep = api.report.steps.find(({ gateResult }) => gateResult?.gateId === 'quality.ui-tokens');
      assert.equal(apiTokenStep.gateResult.status, 'skipped');
      assert.deepEqual(apiTokenStep.gateResult.findings, []);
    }
  });
}
