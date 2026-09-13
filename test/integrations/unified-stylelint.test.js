import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { styleFixture } from '../helpers/stylelint.js';
import { gateRegistry } from '../../src/gates/registry.js';
import { uiTokenGate } from '../../src/gates/quality/ui-token-gate.js';
import { runUnifiedStylelintManual } from '../../src/gates/quality/unified-stylelint-manual.js';
import {
  createProjectDocument,
  normalizeProjectDocument,
} from '../../src/config/project-configuration.js';

const project = {
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-typescript',
};
test('统一样式预设只有一个顶层入口，治理和 Token 默认开启', () => {
  const config = createProjectDocument(project);
  assert.equal(config.checks.stylelint.governance.enabled, true);
  assert.deepEqual(
    config.checks.stylelint.governance.allowedGlobalStylePatterns,
    ['styles/**'],
  );
  assert.equal(config.checks.stylelint.uiTokens.enabled, true);
  for (const field of ['styleComplexity', 'styleGovernance', 'uiTokens'])
    assert.equal(Object.hasOwn(config.checks, field), false);
});

function contextFor(fixture, settings, files = ['src/card.vue']) {
  const config = normalizeProjectDocument({
    version: 2,
    project,
    checks: {
      stylelint: { enabled: true, options: fixture.options, ...settings },
    },
  });
  return {
    root: fixture.root,
    config,
    files,
    plan: { files },
    environment: 'manual',
  };
}

test('主开关关闭时不读取缺失的 Token 清单，也不执行普通规则', async (t) => {
  const fixture = styleFixture(t);
  const context = contextFor(fixture, {
    enabled: false,
    uiTokens: { enabled: true },
  });
  assert.equal(uiTokenGate.plan(context).enabled, false);
  assert.equal((await runUnifiedStylelintManual(context)).status, 'skipped');
});

test('统一命令保留普通规则发现，Token 配置错误按公共优先级阻断', async (t) => {
  const fixture = styleFixture(t);
  fixture.write(
    'src/card.vue',
    '<template><div /></template><style scoped>.card {}</style>',
  );
  const result = await runUnifiedStylelintManual(
    contextFor(fixture, { uiTokens: { enabled: true } }),
  );
  assert.equal(result.status, 'configuration-error');
  assert.ok(
    result.findings.some(
      (finding) => finding.ruleId === 'stylelint/block-no-empty',
    ),
  );
  assert.ok(result.error);
});

test('仅内联配置也可检查 Token，根 styles 目录不漏检', async (t) => {
  const fixture = styleFixture(t);
  assert.equal(
    spawnSync('git', ['init', '--quiet'], { cwd: fixture.root }).status,
    0,
  );
  const source = ':root { --color-brand: #123456; }';
  fixture.write('styles/tokens.css', source);
  fixture.write(
    'ui-tokens.manifest.json',
    JSON.stringify({
      version: 2,
      sources: [
        {
          path: 'styles/tokens.css',
          sha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
      tokens: [
        {
          id: 'color.brand',
          category: 'color',
          aliases: { css: ['var(--color-brand)'] },
        },
      ],
    }),
  );
  fixture.write('styles/card.css', '.card { color: red; }');
  assert.equal(spawnSync('git', ['add', '.'], { cwd: fixture.root }).status, 0);
  const context = contextFor(fixture, { uiTokens: { enabled: true } }, [
    'styles/card.css',
  ]);
  const result = await runUnifiedStylelintManual(context);
  assert.equal(result.status, 'violation');
  assert.ok(
    result.findings.some((finding) => finding.ruleId === 'ui-token/raw-value'),
  );
  fixture.write('styles/card.css', '.card { color: var(--color-brand); }');
  assert.equal((await runUnifiedStylelintManual(context)).status, 'passed');
});

test('实际 CLI 只有统一 Stylelint 命令，旧独立命令被拒绝', (t) => {
  const fixture = styleFixture(t);
  fixture.write(
    'repo-guard.config.json',
    JSON.stringify({
      version: 2,
      project,
      checks: { stylelint: { enabled: true, options: fixture.options } },
    }),
  );
  fixture.write(
    'src/card.vue',
    '<template><div /></template><style scoped>.card { color: red; }</style>',
  );
  assert.equal(
    spawnSync('git', ['init', '--quiet'], { cwd: fixture.root }).status,
    0,
  );
  assert.equal(spawnSync('git', ['add', '.'], { cwd: fixture.root }).status, 0);
  const command = path.resolve('bin/repo-guard.js');
  const run = (name) =>
    spawnSync(process.execPath, [command, name], {
      cwd: fixture.root,
      encoding: 'utf8',
    });
  const result = run('stylelint');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const old of ['ui-tokens', 'style-complexity', 'style-governance'])
    assert.equal(run(old).status, 1);
  assert.equal(
    gateRegistry.get('quality.stylelint').manualCommand,
    'stylelint',
  );
});
test('旧样式字段明确拒绝，不隐式迁移', () => {
  for (const field of ['styleComplexity', 'styleGovernance', 'uiTokens'])
    assert.throws(
      () =>
        normalizeProjectDocument({
          version: 2,
          project,
          checks: { [field]: { enabled: false } },
        }),
      (error) => error.kind === 'configuration',
    );
});
test('主开关关闭时仍保留用户的子能力配置', () => {
  const config = normalizeProjectDocument({
    version: 2,
    project,
    checks: {
      stylelint: {
        enabled: false,
        governance: { enabled: true },
        uiTokens: { enabled: true },
      },
    },
  });
  assert.equal(config.checks.stylelint.enabled, false);
  assert.equal(config.checks.stylelint.governance.enabled, true);
  assert.equal(config.checks.stylelint.uiTokens.enabled, true);
});
