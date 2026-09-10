import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_UI_TOKENS_CONFIG } from '../../src/config/defaults.js';
import { validateConfig } from '../../src/config/configuration-validation.js';
import { runQualityExecution } from '../../src/orchestration/pre-commit/quality-runner.js';
import { runPreCommit } from '../../src/orchestration/pre-commit/runner.js';
import { stringifyProjectFixture } from '../helpers/project-config.js';
import { tokenFixture, tokenManifest } from '../helpers/ui-tokens.js';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function fixture(context) {
  const root = tokenFixture(context);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ui-token-hook-fixture', private: true }));
  writeFileSync(path.join(root, 'stylelint.config.cjs'), 'module.exports = { rules: {} };\n');
  return root;
}

function projectConfiguration() {
  return {
    version: 2,
    project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' },
    checks: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      stylelint: { enabled: false },
      uiTokens: { ...DEFAULT_UI_TOKENS_CONFIG, enabled: true, languages: ['css'] },
    },
    repository: { rules: [{ pattern: 'src/**', category: '源码', level: 'audit' }] },
  };
}

function writeManifest(root, source) {
  writeFileSync(
    path.join(root, 'ui-tokens.manifest.json'),
    `${JSON.stringify(tokenManifest(source), null, 2)}\n`,
  );
}

test('pre-commit 在 Manifest 来源位于源码范围外时仍执行 UI Token 契约检查', async (context) => {
  const root = fixture(context);
  git(root, ['init']);
  const originalTokens = '{"brand":"#123456"}\n';
  const sourcePath = path.join(root, 'design/tokens.json');
  writeFileSync(sourcePath, '{"brand":"#ffffff"}\n');
  writeManifest(root, originalTokens);
  git(root, ['add', '.']);
  const config = validateConfig(projectConfiguration());

  const execution = await runQualityExecution({ root, files: [sourcePath], config });

  assert.equal(execution.decisiveResult.gateId, 'quality.ui-tokens');
  assert.equal(execution.decisiveResult.findings[0].ruleId, 'ui-token/stale-manifest');
});

test('pre-commit 在只有删除项时仍按暂存快照阻断移除 Manifest 来源', async (context) => {
  const root = fixture(context);
  for (const method of ['log', 'error', 'warn']) {
    context.mock.method(console, method, () => {});
  }
  git(root, ['init']);
  const source = '{"brand":"#123456"}\n';
  const sourcePath = path.join(root, 'design/tokens.json');
  writeFileSync(sourcePath, source);
  writeManifest(root, source);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${stringifyProjectFixture(projectConfiguration(), null, 2)}\n`,
  );
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Repo Guard', '-c', 'user.email=repo-guard@example.com', 'commit', '-m', '建立基线']);

  rmSync(sourcePath);
  git(root, ['add', '-u']);
  writeFileSync(sourcePath, source);
  assert.equal(git(root, ['diff', '--cached', '--name-status']).trim(), 'D\tdesign/tokens.json');

  const execution = await runQualityExecution({ root, files: [], config: validateConfig(projectConfiguration()) });
  assert.equal(execution.decisiveResult.gateId, 'quality.ui-tokens');
  assert.equal(execution.decisiveResult.findings[0].ruleId, 'ui-token/stale-manifest');

  assert.equal(await runPreCommit(root), 2);
  assert.equal(readFileSync(sourcePath, 'utf8'), source);
  assert.equal(git(root, ['diff', '--cached', '--name-status']).trim(), 'D\tdesign/tokens.json');
});
