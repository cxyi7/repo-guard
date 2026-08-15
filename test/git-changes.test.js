import assert from 'node:assert/strict';
import test from 'node:test';
import { isRepoGuardError } from '../src/core/error/repo-guard-error.js';
import { createGateResult } from '../src/core/result/gate-result.js';
import { parseNameStatus } from '../src/git/change-collection.js';

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('Expected callback to throw');
}

test('parses normal and renamed NUL-delimited Git change records', () => {
  assert.deepEqual(parseNameStatus('M\0src/a.js\0R100\0src/old.js\0src/new.js\0'), [
    { status: 'M', oldPath: null, path: 'src/a.js' },
    { status: 'R100', oldPath: 'src/old.js', path: 'src/new.js' },
  ]);
});

test('reports an actionable execution issue for an incomplete Git file record', () => {
  const error = captureError(() => parseNameStatus('M'));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'execution');
  assert.equal(error.code, 'git-changes/incomplete-file-entry');
  assert.ok(error.remediation.steps.length > 0);

  const result = createGateResult({
    gateId: 'repository.change-discovery',
    status: 'execution-error',
    summary: error.message,
    error,
  });
  assert.equal(result.issues[0].code, 'git-changes/incomplete-file-entry');
  assert.equal(result.issues[0].evidence[0].type, 'git-name-status-protocol');
});

test('distinguishes an incomplete Git rename or copy record', () => {
  const error = captureError(() => parseNameStatus('R100\0src/old.js'));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'execution');
  assert.equal(error.code, 'git-changes/incomplete-rename-or-copy-entry');
  assert.match(error.expected, /--name-status -z/);
});
