import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';
import { runCiCommand } from '../../src/orchestration/ci/command.js';

test('前后端同名外部门禁使用各自脚本和报告，后端失败不会被前端成功覆盖', async (t) => {
  const files = { 'repo-guard.config.json': JSON.stringify({ version: 2,
    projects: [{ id: 'web', root: 'web' }, { id: 'api', root: 'api' }],
    ci: { enabled: true, profile: 'full', gatePolicy: { defaultMode: 'off' } },
  }) };
  for (const id of ['web', 'api']) {
    const report = { schemaVersion: 2, gateId: 'project.team-check', status: id === 'web' ? 'passed' : 'violation',
      summary: `${id} 的团队检查结果`, findings: id === 'web' ? [] : [{ ruleId: 'team/required', severity: 'error', message: '后端缺少团队要求的工程内容' }], metrics: {}, artifacts: [] };
    files[`${id}/repo-guard.config.json`] = JSON.stringify({ version: 2,
      project: { id, role: id === 'web' ? 'frontend' : 'backend', stack: 'node', preset: id === 'web' ? 'vue-javascript' : 'node-javascript' },
      ci: { gatePolicy: { defaultMode: 'off', gates: { 'project.team-check': { mode: 'enforce' } } },
        externalGates: [{ id: 'project.team-check', enabled: true, environments: ['manual', 'ci-full'],
          script: 'test:team', timeoutMs: 30000, report: { format: 'repo-guard-json-v2', path: 'reports/team.json' } }] },
    });
    files[`${id}/package.json`] = JSON.stringify({ name: id, version: '1.0.0', scripts: { 'test:team': 'node team.mjs' } });
    files[`${id}/team.mjs`] = `import {mkdirSync,writeFileSync} from 'node:fs';\nmkdirSync('reports',{recursive:true});\nwriteFileSync('reports/team.json',${JSON.stringify(JSON.stringify(report))});\nprocess.exitCode = ${id === 'web' ? 0 : 2};\n`;
    files[`${id}/src/value.js`] = 'export const value = 1;\n';
  }
  const root = createGitProjectFixture(t, files);
  const base = fixtureGit(root, ['rev-parse', 'HEAD']);
  for (const id of ['web', 'api']) writeProjectFile(root, `${id}/src/value.js`, 'export const value = 2;\n');
  fixtureGit(root, ['add', '.']);
  fixtureGit(root, ['commit', '-m', 'test: 前后端分别执行团队检查']);
  const exit = await runCiCommand(root, { base, head: 'HEAD', env: { GITLAB_CI: 'true', CI_COMMIT_REF_PROTECTED: 'true' } });
  assert.notEqual(exit, 0);
  const report = JSON.parse(readFileSync(path.join(root, 'reports/repo-guard.json'), 'utf8'));
  assert.deepEqual(report.selectedProjects, ['web', 'api']);
  const results = report.scopedGateResults.filter(({ gateResult }) => gateResult.gateId === 'project.team-check');
  assert.deepEqual(results.map(({ projectId, gateResult }) => [projectId, gateResult.status]), [['web', 'passed'], ['api', 'violation']]);
  assert.equal(report.gateResults.find(({ gateId }) => gateId === 'project.team-check').status, 'violation');
  for (const id of ['web', 'api']) {
    const own = JSON.parse(readFileSync(path.join(root, id, 'reports/team.json'), 'utf8'));
    assert.equal(own.summary, `${id} 的团队检查结果`);
  }
});
