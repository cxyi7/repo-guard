import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  managedTextIsCurrent,
} from '../src/core/policy/managed-text-block.js';
import {
  defineManagedPolicy,
  ensureManagedPolicy,
  isManagedPolicyCurrent,
} from '../src/core/policy/managed-policy.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

test('compares managed text across LF, CRLF, and CR without relaxing content', () => {
  assert.equal(managedTextIsCurrent('first\nsecond\n', 'first\r\nsecond\r\n'), true);
  assert.equal(managedTextIsCurrent('first\rsecond\r', 'first\nsecond\n'), true);
  assert.equal(managedTextIsCurrent('first\nsecond\n', 'first\n second\n'), false);
});

test('accepts a current CRLF managed policy without rewriting the file', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'managed-policy-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'AGENTS.md');
  const policy = defineManagedPolicy({
    id: 'windows-policy',
    buildLines: () => ['## Managed policy', '', '- Keep this rule.'],
  });

  writeFileSync(target, '# Project instructions\n');
  ensureManagedPolicy(root, policy, {});
  const windowsContent = readFileSync(target, 'utf8').replaceAll('\n', '\r\n');
  writeFileSync(target, windowsContent);

  assert.equal(isManagedPolicyCurrent(windowsContent, policy, {}), true);
  assert.deepEqual(ensureManagedPolicy(root, policy, {}), {
    changed: false,
    created: false,
    path: target,
  });
  assert.equal(readFileSync(target, 'utf8'), windowsContent);
});
