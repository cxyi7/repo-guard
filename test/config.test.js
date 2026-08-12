import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_DEPENDENCY_POLICY_CONFIG,
  DEFAULT_ESLINT_PATTERN,
  DEFAULT_EXCEPTIONS_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_PRETTIER_PATTERN,
  DEFAULT_STYLELINT_PATTERN,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
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
  assert.deepEqual(config.exceptions, DEFAULT_EXCEPTIONS_CONFIG);
  assert.deepEqual(config.dependencyPolicy, DEFAULT_DEPENDENCY_POLICY_CONFIG);
  assert.deepEqual(config.architecture, DEFAULT_ARCHITECTURE_CONFIG);
  assert.deepEqual(config.build, DEFAULT_BUILD_CONFIG);
  assert.deepEqual(config.lighthouse, DEFAULT_LIGHTHOUSE_CONFIG);
  assert.deepEqual(config.typeCheck, DEFAULT_TYPE_CHECK_CONFIG);
  assert.deepEqual(config.unitTest, DEFAULT_UNIT_TEST_CONFIG);
  assert.deepEqual(config.preCommit.filePlacement, DEFAULT_FILE_PLACEMENT_CONFIG);
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

test('validates exact, independently approved, time-limited exceptions', () => {
  const validEntry = {
    id: 'legacy-renderer',
    rule: 'security/no-unsafe-html',
    path: 'src/components/LegacyPanel.vue',
    line: 12,
    column: 7,
    reason: 'Temporary trusted HTML renderer exception.',
    owner: 'frontend-team',
    approvedBy: 'security-team',
    ticket: 'SEC-1234',
    createdOn: '2026-08-01',
    expiresOn: '2026-08-31',
  };
  const config = validateConfig(baseConfig({
    exceptions: { warningDays: 7, maxDays: 30, entries: [validEntry] },
  }));
  assert.deepEqual(config.exceptions.entries, [validEntry]);
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [{ ...validEntry, path: 'src/**/*.vue' }],
      },
    })),
    /one exact repository-relative file/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [{ ...validEntry, approvedBy: 'frontend-team' }],
      },
    })),
    /different from owner/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [validEntry, { ...validEntry, line: 13 }],
      },
    })),
    /exception id is duplicated/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [validEntry, { ...validEntry, id: 'second-approval' }],
      },
    })),
    /exception target is duplicated/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        warningDays: 5,
        maxDays: 10,
        entries: [validEntry],
      },
    })),
    /lifetime must be between 1 and 10 days/,
  );
});

test('validates and normalizes architecture dependency rules', () => {
  const config = validateConfig(baseConfig({
    architecture: {
      enabled: true,
      timeoutMs: 90000,
      sourcePaths: ['  src  ', 'packages/ui'],
      tsConfig: '  configs/tsconfig.app.json  ',
      exclude: null,
      rules: [{
        name: 'no-ui-to-api',
        comment: ' Keep the UI independent. ',
        severity: 'error',
        from: { path: '^src/ui/' },
        to: { path: '^src/api/' },
      }],
    },
  }));

  assert.deepEqual(config.architecture, {
    enabled: true,
    timeoutMs: 90000,
    sourcePaths: ['src', 'packages/ui'],
    tsConfig: 'configs/tsconfig.app.json',
    exclude: null,
    rules: [{
      name: 'no-ui-to-api',
      comment: 'Keep the UI independent.',
      severity: 'error',
      from: { path: '^src/ui/' },
      to: { path: '^src/api/' },
    }],
  });
  assert.throws(
    () => validateConfig(baseConfig({
      architecture: { rules: [{ name: 'Bad Name', from: {}, to: {} }] },
    })),
    /kebab-case/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      architecture: {
        rules: [
          { name: 'duplicate', from: {}, to: {} },
          { name: 'duplicate', from: {}, to: {} },
        ],
      },
    })),
    /duplicated/,
  );
});

test('validates and normalizes build gate configuration', () => {
  const config = validateConfig(baseConfig({
    build: {
      enabled: true,
      script: '  build:prod  ',
      timeoutMs: 240000,
    },
  }));

  assert.deepEqual(config.build, {
    enabled: true,
    script: 'build:prod',
    timeoutMs: 240000,
  });
  assert.throws(
    () => validateConfig(baseConfig({ build: { script: 'vite build' } })),
    /must be an npm script name/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ build: { timeoutMs: 0 } })),
    /positive integer/,
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

test('validates and normalizes TypeScript gate configuration', () => {
  const config = validateConfig(baseConfig({
    typeCheck: {
      enabled: true,
      script: '  typecheck:vue  ',
      timeoutMs: 90000,
    },
  }));

  assert.deepEqual(config.typeCheck, {
    enabled: true,
    script: 'typecheck:vue',
    timeoutMs: 90000,
  });
  assert.throws(
    () => validateConfig(baseConfig({ typeCheck: { script: 'vue-tsc --noEmit' } })),
    /must be an npm script name/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ typeCheck: { timeoutMs: 0 } })),
    /positive integer/,
  );
});

test('validates and normalizes unit test configuration', () => {
  const config = validateConfig(baseConfig({
    unitTest: {
      enabled: true,
      script: '  test:unit  ',
      timeoutMs: 60000,
      coverage: true,
      requireTests: 'changedFiles',
      sourcePatterns: ['  src/utils/**/*.js  '],
      testPatterns: ['**/*.spec.js'],
      mappings: [{
        sourcePattern: '  src/utils/**/*.js  ',
        testTemplates: ['  {path}.spec.js  '],
      }],
      exclusions: [],
    },
  }));

  assert.deepEqual(config.unitTest, {
    enabled: true,
    script: 'test:unit',
    timeoutMs: 60000,
    coverage: true,
    requireTests: 'changedFiles',
    sourcePatterns: ['src/utils/**/*.js'],
    testPatterns: ['**/*.spec.js'],
    mappings: [{
      sourcePattern: 'src/utils/**/*.js',
      testTemplates: ['{path}.spec.js'],
    }],
    exclusions: [],
  });
  assert.throws(
    () => validateConfig(baseConfig({ unitTest: { requireTests: 'all' } })),
    /requireTests must be newFiles or changedFiles/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ unitTest: { sourcePatterns: [] } })),
    /sourcePatterns must be a non-empty array/,
  );
  const structuredCoverage = validateConfig(baseConfig({
    unitTest: {
      coverage: {
        enabled: true,
        reportsDirectory: 'reports/coverage',
        thresholds: { lines: 85, changedLines: 95 },
      },
    },
  })).unitTest.coverage;
  assert.deepEqual(structuredCoverage, {
    enabled: true,
    reportsDirectory: 'reports/coverage',
    thresholds: {
      lines: 85,
      statements: 80,
      functions: 80,
      branches: 80,
      changedLines: 95,
    },
  });
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: { coverage: { thresholds: { changedLines: 101 } } },
    })),
    /changedLines must be between 0 and 100/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: { coverage: { reportsDirectory: '../coverage' } },
    })),
    /must stay inside the repository/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: { coverage: { reportsDirectory: 'src' } },
    })),
    /must be a dedicated coverage directory/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: {
        mappings: [{
          sourcePattern: '**/*.ts',
          testTemplates: ['{unknown}.spec.ts'],
        }],
      },
    })),
    /unsupported placeholder/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: {
        mappings: [{
          sourcePattern: '**/*.ts',
          testTemplates: ['tests/all.spec.ts'],
        }],
      },
    })),
    /must contain \{path\} or \{name\}/,
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

test('validates configurable file placement rules', () => {
  const config = validateConfig(baseConfig({
    preCommit: {
      filePlacement: {
        enabled: false,
        mode: 'changedFiles',
        rules: [{
          name: '  设计文件  ',
          patterns: ['  **/*.{fig,sketch}  '],
          allowedPatterns: ['  design/**  '],
          exceptions: ['design/examples/**'],
          suggestedDirectory: '  design/source/  ',
        }],
      },
    },
  }));

  assert.deepEqual(config.preCommit.filePlacement, {
    enabled: false,
    mode: 'changedFiles',
    rules: [{
      name: '设计文件',
      patterns: ['**/*.{fig,sketch}'],
      allowedPatterns: ['design/**'],
      exceptions: ['design/examples/**'],
      suggestedDirectory: 'design/source',
    }],
  });
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: { filePlacement: { mode: 'strict' } },
    })),
    /mode must be newFiles or changedFiles/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        filePlacement: {
          rules: [{
            name: 'Unsafe',
            patterns: ['**/*.key'],
            allowedPatterns: ['../secrets/**'],
            suggestedDirectory: 'secrets',
          }],
        },
      },
    })),
    /must stay inside the repository/,
  );
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

test('validates and normalizes dependency governance configuration', () => {
  const config = validateConfig(baseConfig({
    dependencyPolicy: {
      enabled: true,
      requireExactVersions: false,
      requireLockfile: false,
      allowedProtocols: ['NPM', 'workspace', 'npm'],
      bannedPackages: [{
        name: 'request',
        reason: 'This package is no longer maintained.',
        replacement: 'undici',
      }],
    },
  }));
  assert.deepEqual(config.dependencyPolicy.allowedProtocols, ['npm', 'workspace']);
  assert.equal(config.dependencyPolicy.bannedPackages[0].replacement, 'undici');

  assert.throws(
    () => validateConfig(baseConfig({
      dependencyPolicy: { allowedProtocols: ['https:'] },
    })),
    /protocol name without a colon/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      dependencyPolicy: {
        bannedPackages: [{ name: 'request', reason: 'too short' }],
      },
    })),
    /at least 10 characters/,
  );
});
