import assert from 'node:assert/strict';
import {
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
} from '../src/hook-installer.js';

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

test('upgrades managed v1 hooks to the v2 pre-commit orchestrator', (context) => {
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
  assert.match(hook, /repo-guard-managed:v2/);
  assert.match(hook, /repo_guard_cli" pre-commit/);
  assert.doesNotMatch(hook, /repo_guard_cli" gate/);
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
    /Refusing to overwrite non-managed Git hook/,
  );
});
