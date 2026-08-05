import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ESLINT_PATTERN,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_PRETTIER_PATTERN,
  DEFAULT_STYLELINT_PATTERN,
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

  assert.deepEqual(config.notification, { enabled: true });
  assert.deepEqual(config.lighthouse, DEFAULT_LIGHTHOUSE_CONFIG);
  assert.deepEqual(config.preCommit.maxFileLines, DEFAULT_MAX_FILE_LINES_CONFIG);
  assert.deepEqual(config.preCommit.prettier, {
    enabled: false,
    pattern: DEFAULT_PRETTIER_PATTERN,
    fix: true,
    requireConfig: true,
  });
  assert.deepEqual(config.preCommit.stylelint, {
    enabled: false,
    pattern: DEFAULT_STYLELINT_PATTERN,
    fix: true,
    maxWarnings: 0,
    requireConfig: true,
  });
  assert.deepEqual(config.preCommit.eslint, {
    enabled: false,
    preset: false,
    pattern: DEFAULT_ESLINT_PATTERN,
    fix: true,
    maxWarnings: 0,
  });
});

test('validates the project notification switch', () => {
  const config = validateConfig(baseConfig({
    notification: {
      enabled: false,
    },
  }));

  assert.equal(config.notification.enabled, false);
  assert.throws(
    () => validateConfig(baseConfig({ notification: { enabled: 'no' } })),
    /notification.enabled must be a boolean/,
  );
});

test('validates and normalizes Vue Lighthouse configuration', () => {
  const config = validateConfig(baseConfig({
    lighthouse: {
      enabled: true,
      configFile: '  config/lighthouserc.cjs  ',
      buildScript: '  build:lhci  ',
      timeoutMs: 120000,
    },
  }));

  assert.deepEqual(config.lighthouse, {
    enabled: true,
    configFile: 'config/lighthouserc.cjs',
    buildScript: 'build:lhci',
    timeoutMs: 120000,
  });
  assert.throws(
    () => validateConfig(baseConfig({ lighthouse: { buildScript: 'npm run build' } })),
    /must be an npm script name/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ lighthouse: { timeoutMs: 0 } })),
    /positive integer/,
  );
});

test('validates and normalizes staged Prettier configuration', () => {
  const config = validateConfig(baseConfig({
    preCommit: {
      prettier: {
        enabled: true,
        pattern: '  *.{js,json,css}  ',
        fix: false,
        requireConfig: false,
      },
    },
  }));

  assert.deepEqual(config.preCommit.prettier, {
    enabled: true,
    pattern: '*.{js,json,css}',
    fix: false,
    requireConfig: false,
  });
});

test('validates and normalizes staged ESLint configuration', () => {
  const config = validateConfig(baseConfig({
    preCommit: {
      eslint: {
        enabled: true,
        preset: true,
        pattern: '  *.{js,vue}  ',
        fix: false,
        maxWarnings: 2,
      },
    },
  }));

  assert.deepEqual(config.preCommit.eslint, {
    enabled: true,
    preset: true,
    pattern: '*.{js,vue}',
    fix: false,
    maxWarnings: 2,
  });
});

test('validates and normalizes staged Stylelint configuration', () => {
  const config = validateConfig(baseConfig({
    preCommit: {
      stylelint: {
        enabled: true,
        pattern: '  **/*.{css,scss,vue}  ',
        fix: false,
        maxWarnings: 3,
        requireConfig: false,
      },
    },
  }));

  assert.deepEqual(config.preCommit.stylelint, {
    enabled: true,
    pattern: '**/*.{css,scss,vue}',
    fix: false,
    maxWarnings: 3,
    requireConfig: false,
  });
});

test('validates and normalizes maximum file line rules', () => {
  const config = validateConfig(baseConfig({
    preCommit: {
      maxFileLines: {
        enabled: true,
        mode: 'noRegression',
        warnAt: 0.9,
        rules: [
          { pattern: '  src/**/*.vue  ', maxLines: 700 },
          { pattern: '**/*.js', maxLines: 1000 },
        ],
        exclusions: ['  src/generated/**  '],
      },
    },
  }));

  assert.deepEqual(config.preCommit.maxFileLines, {
    enabled: true,
    mode: 'noRegression',
    warnAt: 0.9,
    rules: [
      { pattern: 'src/**/*.vue', maxLines: 700 },
      { pattern: '**/*.js', maxLines: 1000 },
    ],
    exclusions: ['src/generated/**'],
  });
});

test('rejects invalid maximum file line rules', () => {
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        maxFileLines: {
          rules: [{ pattern: '**/*.vue', maxLines: 0 }],
        },
      },
    })),
    /maxLines must be a positive integer/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        maxFileLines: {
          rules: [],
        },
      },
    })),
    /rules must be a non-empty array/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        maxFileLines: {
          exclusions: [''],
        },
      },
    })),
    /exclusion 1 must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: { maxFileLines: { mode: 'gradual' } },
    })),
    /mode must be strict or noRegression/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: { maxFileLines: { warnAt: 0 } },
    })),
    /warnAt must be greater than 0 and at most 1/,
  );
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
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        eslint: {
          preset: 'yes',
        },
      },
    })),
    /eslint.preset must be a boolean/,
  );
});

test('rejects unknown and invalid staged Prettier properties', () => {
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        prettier: {
          command: 'prettier --write',
        },
      },
    })),
    /unsupported properties: command/,
  );

  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        prettier: {
          requireConfig: 'yes',
        },
      },
    })),
    /requireConfig must be a boolean/,
  );
});

test('rejects unknown and invalid staged Stylelint properties', () => {
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          command: 'stylelint --fix',
        },
      },
    })),
    /unsupported properties: command/,
  );

  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          maxWarnings: -1,
        },
      },
    })),
    /non-negative integer/,
  );
});
