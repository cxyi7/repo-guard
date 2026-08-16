import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureSupportedOptions,
  parseValuedOptions,
} from '../src/orchestration/cli/argument-parsing.js';

test('allows supported options and ignores positional arguments', () => {
  assert.doesNotThrow(() => ensureSupportedOptions(
    ['project.gate', '--dry-run'],
    new Set(['--dry-run']),
  ));
});

test('reports every unsupported option in argument order', () => {
  assert.throws(
    () => ensureSupportedOptions(
      ['--unknown', 'target', '--unsafe'],
      new Set(['--dry-run']),
    ),
    /不支持的选项： --unknown, --unsafe/,
  );
});

test('parses flags and valued options with the last repeated value winning', () => {
  const parsed = parseValuedOptions([
    '--dry-run',
    '--profile',
    'full',
    '--profile',
    'policy',
  ], {
    flags: new Set(['--dry-run']),
    values: new Set(['--profile']),
  });

  assert.deepEqual([...parsed.flags], ['--dry-run']);
  assert.deepEqual(parsed.values, { '--profile': 'policy' });
});

test('requires option values and rejects unsupported arguments', () => {
  const definition = {
    flags: new Set(['--dry-run']),
    values: new Set(['--profile']),
  };
  assert.throws(
    () => parseValuedOptions(['--profile'], definition),
    /--profile 必须提供值/,
  );
  assert.throws(
    () => parseValuedOptions(['--profile', '--dry-run'], definition),
    /--profile 必须提供值/,
  );
  assert.throws(
    () => parseValuedOptions(['unexpected'], definition),
    /不支持的选项或参数： unexpected/,
  );
});
