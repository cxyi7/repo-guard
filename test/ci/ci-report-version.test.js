import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeCiReport } from '../../src/orchestration/ci/report.js';
import { aggregateWorkspaceGateResults } from '../../src/orchestration/ci/workspace-runner.js';

test('CI 报告仅写入 version 2，拒绝旧目标报告且保留已有文件', (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-ci-report-version-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  const reportPath = 'reports/repo-guard.json';
  const file = path.join(root, reportPath);
  const report = { version: 2, status: 'passed', steps: [] };
  for (const version of [1, '2', 3, null, undefined]) {
    assert.throws(() => writeCiReport(root, reportPath, { ...report, version }), /version.*2/);
    assert.equal(existsSync(file), false);
  }
  writeCiReport(root, reportPath, report);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), report);
  const original = readFileSync(file, 'utf8');
  assert.throws(() => writeCiReport(root, reportPath, {
    ...report,
    targets: [{ projectId: 'api', report: { ...report, version: 1 } }],
  }), /version.*2/);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('多应用 CI 汇总拒绝 version 1 的目标报告', () => {
  const report = { version: 2, steps: [] };
  assert.deepEqual(aggregateWorkspaceGateResults([{ projectId: 'api', report }]), []);
  assert.throws(() => aggregateWorkspaceGateResults([
    { projectId: 'api', report: { ...report, version: 1 } },
  ]), /version.*2/);
});

test('CI 嵌套 GateResult 只接受 schemaVersion 2，旧输入在写入前拒绝且不覆盖报告', (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-ci-nested-version-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  const reportPath = 'reports/repo-guard.json';
  const file = path.join(root, reportPath);
  const report = { version: 2, status: 'passed', steps: [{ name: '未附加门禁结果', status: 'passed' }] };
  const gateResult = { schemaVersion: 2, gateId: 'quality.unit-test', status: 'passed' };
  const nestedReports = [
    (result) => ({ ...report, steps: [{ gateResult: result }] }),
    (result) => ({ ...report, gateResult: result }),
    (result) => ({ ...report, gateResults: [result] }),
    (result) => ({ ...report, targets: [{ report: { ...report, gateResult: result } }] }),
  ];
  writeCiReport(root, reportPath, report);
  assert.deepEqual(aggregateWorkspaceGateResults([{ projectId: 'api', report }]), []);
  for (const buildReport of nestedReports) {
    writeCiReport(root, reportPath, buildReport(gateResult));
    const original = readFileSync(file, 'utf8');
    for (const result of [
      ...[1, '2', 3, null, undefined].map((schemaVersion) => ({ ...gateResult, schemaVersion })),
      null,
    ]) {
      const invalid = buildReport(result);
      assert.throws(() => writeCiReport(root, reportPath, invalid), /schemaVersion.*2/);
      assert.equal(readFileSync(file, 'utf8'), original);
      assert.throws(() => aggregateWorkspaceGateResults([{ projectId: 'api', report: invalid }]), /schemaVersion.*2/);
    }
  }
  const original = readFileSync(file, 'utf8');
  assert.throws(() => writeCiReport(root, reportPath, { ...report, gateResults: null }), /GateResult 数组/);
  assert.equal(readFileSync(file, 'utf8'), original);
});
