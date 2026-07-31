import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ESLINT_PATTERN,
  validateConfig,
} from '../src/config.js';

function baseConfig(extra = {}) {
  return {
    version: 1,
    rules: [
      {
        pattern: 'src/**',
        category: 'Source',
        level: 'audit',
      },
    ],
    exclusions: [],
    ...extra,
  };
}

test('existing version 1 configs keep the ESLint gate disabled', () => {
  const config = validateConfig(baseConfig());

  assert.deepEqual(config.preCommit.eslint, {
    enabled: false,
    pattern: DEFAULT_ESLINT_PATTERN,
    fix: true,
    maxWarnings: 0,
  });
});

test('validates and normalizes staged ESLint configuration', () => {
  const config = validateConfig(baseConfig({
    preCommit: {
      eslint: {
        enabled: true,
        pattern: '  *.{js,vue}  ',
        fix: false,
        maxWarnings: 2,
      },
    },
  }));

  assert.deepEqual(config.preCommit.eslint, {
    enabled: true,
    pattern: '*.{js,vue}',
    fix: false,
    maxWarnings: 2,
  });
});

test('rejects unknown and invalid staged ESLint properties', () => {
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        eslint: {
          command: 'npm run lint:fix',
        },
      },
    })),
    /unsupported properties: command/,
  );

  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        eslint: {
          maxWarnings: -1,
        },
      },
    })),
    /non-negative integer/,
  );
});
