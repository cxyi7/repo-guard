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
import {
  CONFIG_FILE as configFileExport,
  validateCiReportPath as configValidateCiReportPath,
} from '../src/config.js';

test('preserves config entry exports for validation primitives', () => {
  assert.equal(configFileExport, CONFIG_FILE);
  assert.equal(configValidateCiReportPath, validateCiReportPath);
});

test('reports unsupported properties through the structured configuration error', () => {
  assert.throws(
    () => assertKnownProperties({ enabled: true, extra: true }, new Set(['enabled']), 'gate'),
    (error) => {
      assert.equal(error.code, 'config/invalid-value');
      assert.match(error.message, /gate has unsupported properties: extra/);
      assert.equal(error.details.location.path, CONFIG_FILE);
      return true;
    },
  );
});

test('normalizes valid dates and rejects impossible calendar dates', () => {
  assert.equal(normalizeIsoDate('2024-02-29', 'createdOn'), '2024-02-29');
  assert.throws(
    () => normalizeIsoDate('2023-02-29', 'createdOn'),
    /createdOn must be a valid calendar date/,
  );
  assert.throws(
    () => normalizeIsoDate('29-02-2024', 'createdOn'),
    /createdOn must use YYYY-MM-DD/,
  );
});

test('normalizes repository patterns and rejects paths that escape the repository', () => {
  assert.equal(normalizeRelativePattern('.\\src\\**\\*.js', 'pattern'), 'src/**/*.js');
  assert.throws(() => normalizeRelativePattern('../secret', 'pattern'), /stay inside/);
  assert.throws(() => normalizeRelativePattern('!src/**', 'pattern'), /stay inside/);
  assert.throws(() => normalizeRelativePattern('C:\\secret', 'pattern'), /stay inside/);
});

test('normalizes pattern lists and enforces empty-list policy', () => {
  assert.deepEqual(
    normalizePatternList(['src\\**', 'docs/**'], 'patterns'),
    ['src/**', 'docs/**'],
  );
  assert.deepEqual(normalizePatternList([], 'patterns', { allowEmpty: true }), []);
  assert.throws(() => normalizePatternList([], 'patterns'), /non-empty array/);
});

test('requires normalized JSON report paths inside reports', () => {
  assert.equal(validateCiReportPath('reports\\ci.json'), 'reports/ci.json');
  assert.throws(() => validateCiReportPath('coverage/ci.json'), /inside reports/);
  assert.throws(() => validateCiReportPath('reports/ci.txt'), /JSON file/);
});
