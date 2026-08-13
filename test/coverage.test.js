import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createChangeSet } from '../src/core/capability/gate-context.js';
import {
  inspectCoverageReports as inspectCoverageReportsWithChangeSet,
  parseChangedLineNumbers,
  parseCoverageSummary,
  parseLcov,
} from '../src/coverage-runner.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function inspectCoverageReports(options) {
  return inspectCoverageReportsWithChangeSet({
    ...options,
    changes: createChangeSet({
      source: 'test',
      changes: options.changes ?? [],
    }),
  });
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function coverageConfig(changedLines = 90) {
  return {
    coverage: {
      enabled: true,
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        changedLines,
      },
    },
    exclusions: [],
    sourcePatterns: ['src/**/*.js'],
    testPatterns: ['**/*.test.js'],
  };
}

function writeReports(root, lcov, percentage = 85) {
  const directory = path.join(root, 'coverage');
  mkdirSync(directory, { recursive: true });
  const metric = { covered: percentage, pct: percentage, total: 100 };
  writeFileSync(path.join(directory, 'coverage-summary.json'), JSON.stringify({
    total: {
      branches: metric,
      functions: metric,
      lines: metric,
      statements: metric,
    },
  }));
  writeFileSync(path.join(directory, 'lcov.info'), lcov);
}

test('parses coverage summaries, LCOV paths, and added diff lines', () => {
  assert.deepEqual(
    [...parseChangedLineNumbers([
      '@@ -1 +1,2 @@',
      '@@ -10,2 +12 @@',
      '@@ -20 +30,0 @@',
    ].join('\n'))],
    [1, 2, 12],
  );
  assert.equal(parseCoverageSummary(JSON.stringify({
    total: {
      lines: { covered: 8, pct: 80, total: 10 },
      statements: { covered: 8, pct: 80, total: 10 },
      functions: { covered: 8, pct: 80, total: 10 },
      branches: { covered: 8, pct: 80, total: 10 },
    },
  })).lines.percentage, 80);
  assert.equal(parseCoverageSummary(JSON.stringify({
    total: {
      lines: { covered: 0, pct: 'Unknown', total: 0 },
      statements: { covered: 0, pct: 'Unknown', total: 0 },
      functions: { covered: 0, pct: 'Unknown', total: 0 },
      branches: { covered: 0, pct: 'Unknown', total: 0 },
    },
  })).branches.percentage, 100);
  const root = path.resolve('fixture-root');
  const files = parseLcov('SF:src/utils/money.js\nDA:2,3\nend_of_record\n', root);
  assert.equal(files.get('src/utils/money.js').get(2), 3);
});

test('enforces global and changed-line thresholds from the exact Git range', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'coverage-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'math.js'), [
    'export function add(left, right) {',
    '  return left + right;',
    '}',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  writeFileSync(path.join(root, 'src', 'math.js'), [
    'export function add(left, right) {',
    '  const result = left + right;',
    '  return result;',
    '}',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'change']);
  const head = git(root, ['rev-parse', 'HEAD']);
  writeReports(root, [
    `SF:${path.join(root, 'src', 'math.js')}`,
    'DA:1,1',
    'DA:2,1',
    'DA:3,0',
    'DA:4,1',
    'end_of_record',
    '',
  ].join('\n'));

  const changes = [{
    baseSha: base,
    headSha: head,
    oldPath: null,
    path: 'src/math.js',
    status: 'M',
  }];
  const failed = inspectCoverageReports({
    root,
    config: coverageConfig(90),
    changes,
  });
  assert.equal(failed.changed.covered, 1);
  assert.equal(failed.changed.total, 2);
  assert.equal(failed.changed.percentage, 50);
  assert.deepEqual(failed.changed.uncovered, ['src/math.js:3']);
  assert.equal(failed.passed, false);

  const passed = inspectCoverageReports({
    root,
    config: coverageConfig(50),
    changes,
  });
  assert.equal(passed.passed, true);
});

test('fails changed coverage when an eligible source has no LCOV record', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'coverage-missing-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'missing.js'), 'export const missing = true;\n');
  writeReports(root, '');

  const result = inspectCoverageReports({
    root,
    config: coverageConfig(),
    changes: [{ status: 'A', oldPath: null, path: 'src/missing.js' }],
  });
  assert.deepEqual(result.changed.missingFiles, ['src/missing.js']);
  assert.equal(result.passed, false);
});
