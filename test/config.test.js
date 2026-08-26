import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_CI_CONFIG,
  DEFAULT_CODE_PLACEMENT_CONFIG,
  DEFAULT_COMMIT_MESSAGE_CONFIG,
  DEFAULT_DEPENDENCY_POLICY_CONFIG,
  DEFAULT_ESLINT_PATTERN,
  DEFAULT_EXCEPTIONS_CONFIG,
  DEFAULT_FILE_HEADER_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_IMAGE_ASSETS_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_MUTATION_TEST_CONFIG,
  DEFAULT_PATH_NAMING_CONFIG,
  DEFAULT_PRETTIER_PATTERN,
  DEFAULT_STYLELINT_PATTERN,
  DEFAULT_STYLE_GOVERNANCE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../src/config/defaults.js';
import { loadConfig } from '../src/config/configuration-loader.js';
import { validateConfig } from '../src/config/configuration-validation.js';
import {
  loadConfig as publicLoadConfig,
  validateConfig as publicValidateConfig,
} from '../src/index.js';

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

test('preserves public configuration lifecycle exports from their owning modules', () => {
  assert.equal(publicLoadConfig, loadConfig);
  assert.equal(publicValidateConfig, validateConfig);
});

test('sparse version 1 configs use the current platform defaults', () => {
  const config = validateConfig(baseConfig());

  assert.deepEqual(config.notification, { enabled: true });
  assert.deepEqual(config.ci, DEFAULT_CI_CONFIG);
  assert.deepEqual(config.codePlacement, DEFAULT_CODE_PLACEMENT_CONFIG);
  assert.deepEqual(config.exceptions, DEFAULT_EXCEPTIONS_CONFIG);
  assert.deepEqual(config.dependencyPolicy, DEFAULT_DEPENDENCY_POLICY_CONFIG);
  assert.deepEqual(config.commitMessage, DEFAULT_COMMIT_MESSAGE_CONFIG);
  assert.deepEqual(config.imageAssets, DEFAULT_IMAGE_ASSETS_CONFIG);
  assert.deepEqual(config.architecture, DEFAULT_ARCHITECTURE_CONFIG);
  assert.deepEqual(config.accessibilityTest, DEFAULT_ACCESSIBILITY_TEST_CONFIG);
  assert.deepEqual(config.build, DEFAULT_BUILD_CONFIG);
  assert.deepEqual(config.lighthouse, DEFAULT_LIGHTHOUSE_CONFIG);
  assert.deepEqual(config.typeCheck, DEFAULT_TYPE_CHECK_CONFIG);
  assert.deepEqual(config.unitTest, DEFAULT_UNIT_TEST_CONFIG);
  assert.deepEqual(config.mutationTest, DEFAULT_MUTATION_TEST_CONFIG);
  assert.deepEqual(config.preCommit.filePlacement, DEFAULT_FILE_PLACEMENT_CONFIG);
  assert.deepEqual(config.preCommit.fileHeader, DEFAULT_FILE_HEADER_CONFIG);
  assert.deepEqual(config.preCommit.pathNaming, DEFAULT_PATH_NAMING_CONFIG);
  assert.deepEqual(config.preCommit.maxFileLines, DEFAULT_MAX_FILE_LINES_CONFIG);
  assert.deepEqual(config.preCommit.prettier, {
    enabled: true,
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
    complexity: {
      enabled: false,
      maxCompoundSelectors: 3,
      maxNestingDepth: 3,
    },
    governance: DEFAULT_STYLE_GOVERNANCE_CONFIG,
  });
  assert.deepEqual(config.preCommit.eslint, {
    enabled: true,
    preset: true,
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
    /notification.enabled 必须是布尔值/,
  );
});

test('validates read-only CI profiles, reports, and protected-file actions', () => {
  const config = validateConfig(baseConfig({
    ci: {
      enabled: true,
      profile: 'full',
      reportPath: 'reports/custom.json',
      protectedFiles: { action: 'fail' },
    },
  }));
  assert.deepEqual(config.ci, {
    enabled: true,
    profile: 'full',
    reportPath: 'reports/custom.json',
    protectedFiles: { action: 'fail' },
    gatePolicy: { defaultMode: 'inherit', gates: {} },
    pipeline: DEFAULT_CI_CONFIG.pipeline,
  });
  assert.throws(
    () => validateConfig(baseConfig({ ci: { profile: 'partial' } })),
    /ci.profile 必须为 policy、full 或 release-ready/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ ci: { reportPath: '../report.json' } })),
    /必须位于仓库内部/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ ci: { reportPath: 'ci-report.json' } })),
    /必须是 reports\/ 内的 JSON 文件/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ ci: { reportPath: 'reports/output.txt' } })),
    /必须是 reports\/ 内的 JSON 文件/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ ci: { protectedFiles: { action: 'approve' } } })),
    /必须为 report 或 fail/,
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
    /准确的单一仓库相对文件路径/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [{ ...validEntry, approvedBy: 'frontend-team' }],
      },
    })),
    /不能与 owner 相同/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [validEntry, { ...validEntry, line: 13 }],
      },
    })),
    /例外 id 重复/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        entries: [validEntry, { ...validEntry, id: 'second-approval' }],
      },
    })),
    /例外目标重复/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      exceptions: {
        warningDays: 5,
        maxDays: 10,
        entries: [validEntry],
      },
    })),
    /有效期必须介于 1 到 10 天之间/,
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
    /规则名称重复/,
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
    artifactBudget: DEFAULT_BUILD_CONFIG.artifactBudget,
  });
  assert.throws(
    () => validateConfig(baseConfig({ build: { script: 'vite build' } })),
    /必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ build: { timeoutMs: 0 } })),
    /正整数/,
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
    /必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ lighthouse: { timeoutMs: 0 } })),
    /正整数/,
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
    /必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ typeCheck: { timeoutMs: 0 } })),
    /正整数/,
  );
});

test('validates and normalizes axe accessibility test configuration', () => {
  const config = validateConfig(baseConfig({
    accessibilityTest: {
      enabled: true,
      script: '  test:a11y:e2e  ',
      timeoutMs: 90000,
      testPatterns: ['  e2e/accessibility/**/*.spec.ts  '],
    },
  }));

  assert.deepEqual(config.accessibilityTest, {
    enabled: true,
    script: 'test:a11y:e2e',
    timeoutMs: 90000,
    testPatterns: ['e2e/accessibility/**/*.spec.ts'],
  });
  assert.throws(
    () => validateConfig(baseConfig({
      accessibilityTest: { script: 'playwright test' },
    })),
    /必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ accessibilityTest: { testPatterns: [] } })),
    /必须是非空数组/,
  );
});

test('validates and normalizes unit test configuration', () => {
  const config = validateConfig(baseConfig({
    unitTest: {
      enabled: true,
      script: '  test:unit  ',
      timeoutMs: 60000,
      coverage: {
        enabled: true,
        reportsDirectory: 'coverage',
        thresholds: {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
          changedLines: 90,
        },
      },
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
    coverage: {
      enabled: true,
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        changedLines: 90,
      },
    },
    componentInteraction: {
      enabled: false,
      componentPatterns: ['src/components/**/*.vue'],
    },
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
    /requireTests 必须为 newFiles 或 changedFiles/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ unitTest: { sourcePatterns: [] } })),
    /sourcePatterns 必须是非空数组/,
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
    /changedLines 必须介于 0 到 100 之间/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: { coverage: { reportsDirectory: '../coverage' } },
    })),
    /必须位于仓库内部/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: { coverage: { reportsDirectory: 'src' } },
    })),
    /必须是专用的覆盖率目录/,
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
    /不支持的占位符/,
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
    /必须包含 \{path\} 或 \{name\}/,
  );
});

test('requires unit tests when component interaction semantics are enabled', () => {
  assert.throws(
    () => validateConfig(baseConfig({
      unitTest: {
        enabled: false,
        componentInteraction: { enabled: true },
      },
    })),
    /componentInteraction\.enabled 要求启用 unitTest\.enabled/,
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
        complexity: {
          enabled: true,
          maxCompoundSelectors: 2,
          maxNestingDepth: 4,
        },
        governance: {
          enabled: true,
          maxSpecificity: '0,2,1',
          maxIdSelectors: 0,
          disallowImportant: true,
          allowedGlobalStylePatterns: ['  src/styles/**  ', 'src/App.vue'],
        },
      },
    },
  }));

  assert.deepEqual(config.preCommit.stylelint, {
    enabled: true,
    pattern: '**/*.{css,scss,vue}',
    fix: false,
    maxWarnings: 3,
    requireConfig: false,
    complexity: {
      enabled: true,
      maxCompoundSelectors: 2,
      maxNestingDepth: 4,
    },
    governance: {
      enabled: true,
      maxSpecificity: '0,2,1',
      maxIdSelectors: 0,
      disallowImportant: true,
      allowedGlobalStylePatterns: ['src/styles/**', 'src/App.vue'],
    },
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
    /mode 必须为 newFiles 或 changedFiles/,
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
    /必须位于仓库内部/,
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
    /maxLines 必须是正整数/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        maxFileLines: {
          rules: [],
        },
      },
    })),
    /rules 必须是非空数组/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        maxFileLines: {
          exclusions: [''],
        },
      },
    })),
    /排除项 1 必须是非空字符串/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: { maxFileLines: { mode: 'gradual' } },
    })),
    /mode 必须为 strict 或 noRegression/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: { maxFileLines: { warnAt: 0 } },
    })),
    /warnAt 必须大于 0 且不超过 1/,
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
    /包含不支持的属性： command/,
  );

  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        eslint: {
          maxWarnings: -1,
        },
      },
    })),
    /非负整数/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        eslint: {
          preset: 'yes',
        },
      },
    })),
    /eslint.preset 必须是布尔值/,
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
    /包含不支持的属性： command/,
  );

  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        prettier: {
          requireConfig: 'yes',
        },
      },
    })),
    /requireConfig 必须是布尔值/,
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
    /包含不支持的属性： command/,
  );

  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          maxWarnings: -1,
        },
      },
    })),
    /非负整数/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          complexity: { maxNestingDepth: -1 },
        },
      },
    })),
    /maxNestingDepth 必须是非负整数/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          enabled: false,
          complexity: { enabled: true },
        },
      },
    })),
    /complexity.enabled 要求启用 preCommit.stylelint.enabled/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          governance: { maxSpecificity: 'high' },
        },
      },
    })),
    /maxSpecificity 必须使用 "id,class,type" 格式/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          governance: { maxIdSelectors: -1 },
        },
      },
    })),
    /maxIdSelectors 必须是非负整数/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      preCommit: {
        stylelint: {
          enabled: false,
          governance: { enabled: true },
        },
      },
    })),
    /governance.enabled 要求启用 preCommit.stylelint.enabled/,
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
    /不含冒号的协议名称/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      dependencyPolicy: {
        bannedPackages: [{ name: 'request', reason: 'too short' }],
      },
    })),
    /至少包含 10 个字符/,
  );
});

test('validates and normalizes commit message policy configuration', () => {
  const config = validateConfig(baseConfig({
    commitMessage: {
      enabled: true,
      types: ['feat', 'fix'],
      requireScope: true,
      allowedScopes: ['auth', 'api/v2'],
      headerMaxLength: 72,
      breakingChange: { requireMajorVersionOnRelease: false },
      merge: { allowed: false },
      revert: { allowed: false },
      fixup: { allowPush: true },
    },
  }));

  assert.deepEqual(config.commitMessage, {
    enabled: true,
    types: ['feat', 'fix'],
    requireScope: true,
    allowedScopes: ['auth', 'api/v2'],
    headerMaxLength: 72,
    breakingChange: {
      allowed: true,
      requireMarker: true,
      requireFooter: true,
      requireMajorVersionOnRelease: false,
    },
    merge: { allowed: false },
    revert: { allowed: false },
    fixup: { allowLocal: true, allowPush: true, allowCi: false },
  });

  for (const [commitMessage, expected] of [
    [{ enabled: 'yes' }, /commitMessage\.enabled 必须是布尔值/],
    [{ types: [] }, /commitMessage\.types 必须是非空规范标识符数组/],
    [{ types: ['feat', 'feat'] }, /commitMessage\.types 不得包含重复值/],
    [{ allowedScopes: ['Auth'] }, /commitMessage\.allowedScopes 必须是规范标识符数组/],
    [{ headerMaxLength: 9 }, /commitMessage\.headerMaxLength 必须是大于或等于 10 的整数/],
    [{ breakingChange: { unknown: true } }, /commitMessage\.breakingChange 包含不支持的属性： unknown/],
    [{ fixup: { allowCi: 'yes' } }, /commitMessage\.fixup\.allowCi 必须是布尔值/],
  ]) {
    assert.throws(() => validateConfig(baseConfig({ commitMessage })), expected);
  }
});

test('validates strict external project gate configuration', () => {
  const entry = {
    id: 'project.api-contract',
    enabled: true,
    environments: ['manual', 'ci-full'],
    script: 'test:api-contract',
    timeoutMs: 120000,
    report: {
      format: 'repo-guard-json-v1',
      path: 'reports/api-contract.json',
    },
  };
  const config = validateConfig(baseConfig({ externalGates: [entry] }));
  assert.deepEqual(config.externalGates, [entry]);

  for (const [change, pattern] of [
    [{ id: 'api-contract' }, /project\.<kebab-case>/],
    [{ environments: ['pre-push'] }, /不重复的 manual、ci-full 或 release-ready/],
    [{ script: 'npm test && deploy' }, /准确的 npm 脚本名称/],
    [{ timeoutMs: 999 }, /介于 1000 到 1800000 之间/],
    [{ report: { format: 'junit', path: 'reports/api-contract.json' } }, /repo-guard-json-v1/],
    [{ report: { format: 'repo-guard-json-v1', path: '../api.json' } }, /规范化路径/],
    [{ report: { format: 'repo-guard-json-v1', path: 'reports\\api.json' } }, /规范化路径/],
    [{ report: { format: 'repo-guard-json-v1', path: 'reports/alias./api.json' } }, /规范化路径/],
    [{ report: { format: 'repo-guard-json-v1', path: 'reports/CON.json' } }, /规范化路径/],
  ]) {
    assert.throws(
      () => validateConfig(baseConfig({ externalGates: [{ ...entry, ...change }] })),
      pattern,
    );
  }
  assert.throws(
    () => validateConfig(baseConfig({ externalGates: [entry, entry] })),
    /外部门禁 id 重复/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ externalGates: [
      entry,
      { ...entry, id: 'project.browser' },
    ] })),
    /报告路径重复/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ externalGates: [
      entry,
      {
        ...entry,
        id: 'project.browser',
        report: { ...entry.report, path: 'reports/API-CONTRACT.json' },
      },
    ] })),
    /报告路径重复/,
  );
  assert.throws(
    () => validateConfig(baseConfig({ externalGates: [{ ...entry, command: 'node test.js' }] })),
    /包含不支持的属性： command/,
  );
  assert.throws(
    () => validateConfig(baseConfig({
      ci: {
        enabled: true,
        profile: 'full',
        reportPath: 'reports/api-contract.json',
        protectedFiles: { action: 'report' },
      },
      externalGates: [entry],
    })),
    /不能与 ci\.reportPath 相同/,
  );
});
