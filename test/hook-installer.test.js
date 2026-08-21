import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  installHooks,
  isCurrentManagedHook,
  isManagedHook,
} from '../src/orchestration/setup/hook-installer.js';
import { createStarterConfig } from '../src/orchestration/setup/config-management.js';
import { ensureGitAttributes } from '../src/orchestration/setup/git-attributes.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function createRepository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'hooks-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  return root;
}

test('preserves manual Git attributes while maintaining an idempotent managed block', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, '.gitattributes');
  writeFileSync(target, '*.png binary\n');

  const first = ensureGitAttributes(root);
  const managed = readFileSync(target, 'utf8');
  const windowsManaged = managed.replaceAll('\n', '\r\n');
  writeFileSync(target, windowsManaged);
  const second = ensureGitAttributes(root);

  assert.deepEqual(first, { changed: true, path: target });
  assert.match(managed, /^\*\.png binary\n/);
  assert.match(managed, /# repo-guard-managed:attributes:start/);
  assert.match(managed, /\.githooks\/\* text eol=lf/);
  assert.match(managed, /repo-guard\.config\.json text eol=lf/);
  assert.match(managed, /# repo-guard-managed:attributes:end/);
  assert.deepEqual(second, { changed: false, path: target });
  assert.equal(readFileSync(target, 'utf8'), windowsManaged);
});

test('does not rewrite current managed ignore blocks solely for CRLF', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  installHooks({ cwd: root });
  const target = path.join(root, '.gitignore');
  const windowsManaged = readFileSync(target, 'utf8').replaceAll('\n', '\r\n');
  writeFileSync(target, windowsManaged);

  const result = installHooks({ cwd: root });

  assert.equal(result.localEnvironment.gitIgnore.changed, false);
  assert.equal(result.lighthouseIgnore.changed, false);
  assert.equal(readFileSync(target, 'utf8'), windowsManaged);
});

test('skips hook installation when the CI environment requests it', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = installHooks({
    cwd: root,
    env: { REPO_GUARD_SKIP_HOOKS: '1' },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.root, null);
  assert.equal(existsSync(path.join(root, '.githooks')), false);
});

test('upgrades managed v1 hooks to the v4 orchestrator', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(path.join(root, '.githooks'), { recursive: true });
  writeFileSync(
    path.join(root, '.githooks', 'pre-commit'),
    '#!/bin/sh\n# repo-guard-managed:v1\nexec node old-cli gate\n',
  );

  installHooks({ cwd: root });
  const hook = readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8');

  assert.equal(isManagedHook(hook), true);
  assert.equal(isCurrentManagedHook(hook), true);
  assert.equal(isManagedHook(hook.replaceAll('\n', '\r')), true);
  assert.equal(isCurrentManagedHook(hook.replaceAll('\n', '\r')), true);
  assert.match(hook, /repo-guard-managed:v4/);
  assert.match(hook, /repo_guard_cli" pre-commit/);
  assert.doesNotMatch(hook, /repo_guard_cli" gate/);
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /coverage\//);
  assert.match(
    readFileSync(path.join(root, '.githooks', 'pre-push'), 'utf8'),
    /repo_guard_cli" pre-push "\$@"/,
  );
});

test('ignores the configured coverage report directory', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = createStarterConfig();
  config.unitTest.coverage.reportsDirectory = 'reports/coverage';
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  installHooks({ cwd: root });
  assert.match(
    readFileSync(path.join(root, '.gitignore'), 'utf8'),
    /reports\/coverage\//,
  );
});

test('init adds guarded build aliases and mutation reports to the managed ignore block', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const packagePath = path.join(root, 'package.json');
  writeFileSync(packagePath, `${JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    scripts: {
      'build:mp-weixin': 'vite build --mode mp-weixin',
      'guard:build:h5': 'custom-command',
    },
  }, null, 2)}\n`);
  const config = createStarterConfig();
  config.mutationTest.enabled = true;
  config.mutationTest.reportsDirectory = 'reports/mutation-custom';
  config.mutationTest.guardedBuilds = [
    {
      script: 'build:mp-weixin',
      packageScript: 'guard:build:mp-weixin',
      timeoutMs: 300000,
      notifyOnFailure: true,
    },
    {
      script: 'build:h5',
      packageScript: 'guard:build:h5',
      timeoutMs: 300000,
      notifyOnFailure: true,
    },
  ];
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  installHooks({ cwd: root, updatePackageScripts: true });

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  assert.equal(
    packageJson.scripts['guard:build:mp-weixin'],
    'repo-guard guarded-build build:mp-weixin',
  );
  assert.equal(packageJson.scripts['guard:build:h5'], 'custom-command');
  assert.match(
    readFileSync(path.join(root, '.gitignore'), 'utf8'),
    /reports\/mutation-custom\//,
  );
});

test('refuses to overwrite a non-managed hook', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(path.join(root, '.githooks'), { recursive: true });
  writeFileSync(
    path.join(root, '.githooks', 'pre-commit'),
    '#!/bin/sh\necho custom\n',
  );

  assert.throws(
    () => installHooks({ cwd: root }),
    /拒绝覆盖非托管 Git Hook/,
  );
});

test('does not trust a managed marker embedded in custom hook text', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(path.join(root, '.githooks'), { recursive: true });
  const custom = [
    '#!/bin/sh',
    'echo "custom documentation mentions # repo-guard-managed:v1"',
    '',
  ].join('\n');
  writeFileSync(path.join(root, '.githooks', 'pre-commit'), custom);

  assert.equal(isManagedHook(custom), false);
  assert.throws(
    () => installHooks({ cwd: root }),
    /拒绝覆盖非托管 Git Hook/,
  );
  assert.equal(readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8'), custom);
});

test('recognizes and upgrades managed v2 hooks', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(path.join(root, '.githooks'), { recursive: true });
  writeFileSync(
    path.join(root, '.githooks', 'pre-commit'),
    '#!/bin/sh\n# repo-guard-managed:v2\nexec node old-cli pre-commit\n',
  );

  installHooks({ cwd: root });
  assert.match(
    readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8'),
    /repo-guard-managed:v4/,
  );
});

test('recognizes and upgrades managed v3 hooks', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(path.join(root, '.githooks'), { recursive: true });
  writeFileSync(
    path.join(root, '.githooks', 'pre-push'),
    '#!/bin/sh\n# repo-guard-managed:v3\nexec node old-cli pre-push\n',
  );

  installHooks({ cwd: root });
  const hook = readFileSync(path.join(root, '.githooks', 'pre-push'), 'utf8');
  assert.match(hook, /repo-guard-managed:v4/);
  assert.match(hook, /pre-push "\$@"/);
});

test('preflights every hook before upgrading any managed file', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(path.join(root, '.githooks'), { recursive: true });
  const legacyHook = '#!/bin/sh\n# repo-guard-managed:v1\nexec node old-cli gate\n';
  writeFileSync(path.join(root, '.githooks', 'pre-commit'), legacyHook);
  writeFileSync(
    path.join(root, '.githooks', 'prepare-commit-msg'),
    '#!/bin/sh\necho custom\n',
  );

  assert.throws(
    () => installHooks({ cwd: root }),
    /拒绝覆盖非托管 Git Hook/,
  );
  assert.equal(
    readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8'),
    legacyHook,
  );
});
