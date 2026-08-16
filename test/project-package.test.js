import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isRepoGuardError } from '../src/core/error/repo-guard-error.js';
import { createGateResult } from '../src/core/result/gate-result.js';
import { resolveProjectPackageMetadata } from '../src/core/project/package.js';

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('Expected callback to throw');
}

test('reports a typed configuration issue when package.json is missing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  const error = captureError(() => resolveProjectPackageMetadata(root, 'vitest', 'Vitest'));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'configuration');
  assert.equal(error.code, 'project-package/missing-manifest');
  assert.equal(error.details.location.path, 'package.json');
  assert.ok(error.remediation.steps.length > 0);
});

test('reports a typed configuration issue when a project dependency is missing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const error = captureError(() => resolveProjectPackageMetadata(root, 'vitest', 'Vitest'));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'configuration');
  assert.equal(error.code, 'project-package/dependency-not-installed');
  assert.deepEqual(error.details.evidence, [{
    type: 'dependency-resolution',
    message: '请求的包： vitest；集成： Vitest',
    location: { path: 'package.json' },
  }]);
  assert.match(error.expected, /devDependency/);

  const result = createGateResult({
    gateId: 'quality.unit-test',
    status: 'configuration-error',
    summary: error.message,
    error,
  });
  assert.equal(result.issues[0].code, 'project-package/dependency-not-installed');
  assert.equal(result.issues[0].evidence[0].type, 'dependency-resolution');
  assert.ok(result.issues[0].remediation.steps.length > 0);
});

test('distinguishes an installed package with an unresolvable runtime entry', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const packageRoot = path.join(root, 'node_modules', 'broken-tool');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"broken-tool","version":"1.2.3"}\n');

  const error = captureError(() => (
    resolveProjectPackageMetadata(root, 'broken-tool', 'Broken tool')
  ));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'configuration');
  assert.equal(error.code, 'project-package/dependency-entry-unresolvable');
  assert.ok(error.cause instanceof Error);
});
