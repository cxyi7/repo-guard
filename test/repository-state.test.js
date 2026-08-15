import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  clearCommitMessageState,
  notificationWasSent,
  readCommitMessageState,
  saveCommitMessageState,
  saveNotificationState,
} from '../src/integrations/git/repository-state.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function createRepository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'repository-state-'));
  const result = spawnSync('git', ['init'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return root;
}

test('persists notification fingerprints with an ISO timestamp in Git metadata', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(notificationWasSent(root, 'fingerprint-a'), false);
  saveNotificationState(root, 'fingerprint-a');

  const target = path.join(root, '.git', 'repo-guard-notified.json');
  const persisted = JSON.parse(readFileSync(target, 'utf8'));
  const notifiedAt = Date.parse(persisted.notifiedAt);
  assert.equal(persisted.fingerprint, 'fingerprint-a');
  assert.ok(Number.isFinite(notifiedAt));
  assert.equal(new Date(notifiedAt).toISOString(), persisted.notifiedAt);
  assert.equal(notificationWasSent(root, 'fingerprint-a'), true);
  assert.equal(notificationWasSent(root, 'fingerprint-b'), false);
});

test('round-trips and clears commit-message state while ignoring malformed JSON', (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, '.git', 'repo-guard-commit-message.json');
  writeFileSync(target, '{invalid json', 'utf8');

  assert.equal(readCommitMessageState(root), null);

  const state = {
    base: 'abc123',
    changes: [{ path: 'src/example.js', status: 'M' }],
    version: 1,
  };
  saveCommitMessageState(root, state);
  assert.deepEqual(readCommitMessageState(root), state);

  clearCommitMessageState(root);
  assert.equal(existsSync(target), false);
  assert.equal(readCommitMessageState(root), null);
});
