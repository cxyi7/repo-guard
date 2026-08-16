import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runGate } from '../src/orchestration/cli/gate.js';
import { buildNotificationText } from '../src/policies/wecom-notification.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function createRepository(notification) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'notification-gate-'));
  git(root, ['init']);
  writeFileSync(path.join(root, 'sample.js'), 'const value = 1;\n');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      notification,
      rules: [{ pattern: 'sample.js', category: 'Sample', level: 'notify' }],
    }, null, 2)}\n`,
  );
  git(root, ['add', 'sample.js']);
  return root;
}

test('disabled notification lets notify-level changes pass without credentials', async (context) => {
  const root = createRepository({ enabled: false });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(await runGate({ cwd: root, forceNotify: true }), 0);
});

test('enabled notification still requires WeCom credentials', async (context) => {
  const root = createRepository({ enabled: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    () => runGate({ cwd: root }),
    /未配置 REPO_GUARD_WECOM_WEBHOOK/,
  );
});

test('redacts credentials from SCP-style Git remotes in notifications', (context) => {
  const root = createRepository({ enabled: false });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['remote', 'add', 'origin', 'secret-token@git.example.com:group/repo.git']);

  const output = buildNotificationText(root, [], 'sha256:test');
  assert.doesNotMatch(output, /secret-token/);
  assert.match(output, /Remote: git\.example\.com:group\/repo\.git/);
});
