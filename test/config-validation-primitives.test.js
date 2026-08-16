import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKnownProperties,
  CONFIG_FILE,
  normalizeIsoDate,
  normalizePatternList,
  normalizeRelativePattern,
  validateCiReportPath,
} from '../src/config/validation-primitives.js';
test('reports unsupported properties through the structured configuration error', () => {
  assert.throws(
    () => assertKnownProperties({ enabled: true, extra: true }, new Set(['enabled']), 'gate'),
    (error) => {
      assert.equal(error.code, 'config/invalid-value');
      assert.match(error.message, /gate 包含不支持的属性： extra/);
      assert.equal(error.details.location.path, CONFIG_FILE);
      return true;
    },
  );
});

test('normalizes valid dates and rejects impossible calendar dates', () => {
  assert.equal(normalizeIsoDate('2024-02-29', 'createdOn'), '2024-02-29');
  assert.throws(
    () => normalizeIsoDate('2023-02-29', 'createdOn'),
    /createdOn 必须是有效的日历日期/,
  );
  assert.throws(
    () => normalizeIsoDate('29-02-2024', 'createdOn'),
    /createdOn 必须使用 YYYY-MM-DD 格式/,
  );
});

test('normalizes repository patterns and rejects paths that escape the repository', () => {
  assert.equal(normalizeRelativePattern('.\\src\\**\\*.js', 'pattern'), 'src/**/*.js');
  assert.throws(() => normalizeRelativePattern('../secret', 'pattern'), /必须位于仓库内部/);
  assert.throws(() => normalizeRelativePattern('!src/**', 'pattern'), /必须位于仓库内部/);
  assert.throws(() => normalizeRelativePattern('C:\\secret', 'pattern'), /必须位于仓库内部/);
});

test('normalizes pattern lists and enforces empty-list policy', () => {
  assert.deepEqual(
    normalizePatternList(['src\\**', 'docs/**'], 'patterns'),
    ['src/**', 'docs/**'],
  );
  assert.deepEqual(normalizePatternList([], 'patterns', { allowEmpty: true }), []);
  assert.throws(() => normalizePatternList([], 'patterns'), /必须是非空数组/);
});

test('requires normalized JSON report paths inside reports', () => {
  assert.equal(validateCiReportPath('reports\\ci.json'), 'reports/ci.json');
  assert.throws(() => validateCiReportPath('coverage/ci.json'), /reports\/ 内的 JSON 文件/);
  assert.throws(() => validateCiReportPath('reports/ci.txt'), /JSON 文件/);
});
