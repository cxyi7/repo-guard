import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfig } from '../src/config/configuration-validation.js';
import { createChangeSet } from '../src/core/capability/gate-context.js';
import { protectedFilesGate } from '../src/gates/repository/repository-policy-gates.js';

const IMMUTABLE_FILE = 'src/security/permission-map.ts';

function protectedConfig({ action = 'report', level = 'block', rules = null } = {}) {
  return validateConfig({
    version: 1,
    notification: { enabled: false },
    ci: {
      enabled: true,
      profile: 'policy',
      reportPath: 'reports/repo-guard.json',
      protectedFiles: { action },
    },
    rules: rules ?? [{
      pattern: IMMUTABLE_FILE,
      category: '不可变安全文件',
      level,
    }],
    exclusions: [],
  });
}

function gatePlan(config, changes, mutation = 'read-only') {
  return protectedFilesGate.plan({
    config,
    changes: createChangeSet({ source: 'test', changes }),
    step: { mutation },
  });
}

test('block rules reject modifications, deletions, renames, and moves', async () => {
  const config = protectedConfig();
  const changes = [
    { status: 'M', oldPath: null, path: IMMUTABLE_FILE },
    { status: 'D', oldPath: null, path: IMMUTABLE_FILE },
    {
      status: 'R100',
      oldPath: IMMUTABLE_FILE,
      path: 'src/shared/permission-map.ts',
    },
  ];
  const result = await protectedFilesGate.run({
    root: process.cwd(),
    config,
    plan: gatePlan(config, changes),
  });

  assert.equal(result.status, 'violation');
  assert.deepEqual(result.metrics, { blockedChanges: 3, protectedChanges: 3 });
  assert.equal(result.findings.every(({ severity }) => severity === 'error'), true);
  assert.match(result.findings[0].message, /不允许修改、删除、重命名或移动/);
  assert.equal(
    result.findings[2].message.startsWith(
      'src/security/permission-map.ts -> src/shared/permission-map.ts',
    ),
    true,
  );
  assert.equal(result.findings[0].remediation.goal, '撤销不可变文件的本次变更');
});

test('a destination audit rule cannot downgrade a block rule from the original path', async () => {
  const config = protectedConfig({
    rules: [
      {
        pattern: IMMUTABLE_FILE,
        category: '不可变安全文件',
        level: 'block',
      },
      {
        pattern: 'src/shared/**',
        category: '共享文件',
        level: 'audit',
      },
    ],
  });
  const changes = [{
    status: 'R100',
    oldPath: IMMUTABLE_FILE,
    path: 'src/shared/permission-map.ts',
  }];
  const result = await protectedFilesGate.run({
    root: process.cwd(),
    config,
    plan: gatePlan(config, changes),
  });

  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].severity, 'error');
  assert.match(result.findings[0].message, /不可变安全文件/);
});

test('audit and notify rules keep their existing non-blocking behavior', async () => {
  for (const level of ['audit', 'notify']) {
    const config = protectedConfig({ level });
    const changes = [{ status: 'M', oldPath: null, path: IMMUTABLE_FILE }];
    const result = await protectedFilesGate.run({
      root: process.cwd(),
      config,
      plan: gatePlan(config, changes),
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.diagnostics[0].level, 'warn');
    assert.match(result.diagnostics[0].message, /受保护/);
  }
});

test('CI fail action still promotes every protected-file level to an error', async () => {
  const config = protectedConfig({ action: 'fail', level: 'audit' });
  const changes = [{ status: 'M', oldPath: null, path: IMMUTABLE_FILE }];
  const result = await protectedFilesGate.run({
    root: process.cwd(),
    config,
    plan: gatePlan(config, changes),
  });

  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].severity, 'error');
  assert.match(result.findings[0].message, /当前 CI 策略要求阻断/);
  assert.equal(result.findings[0].remediation.goal, '处理当前受保护文件变更');
});
