import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
  validateConfig,
} from './config.js';

export const CONFIG_SCHEMA_PATH = './node_modules/@cxyi7/repo-guard/config.schema.json';
export const QUALITY_GATES = Object.freeze(['eslint', 'prettier', 'stylelint']);
export const CONFIGURABLE_FEATURES = Object.freeze([
  ...QUALITY_GATES,
  'filePlacement',
  'maxFileLines',
  'build',
  'lighthouse',
  'typeCheck',
  'unitTest',
  'notification',
]);

function cloneFilePlacementConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_FILE_PLACEMENT_CONFIG.rules;
  return {
    ...DEFAULT_FILE_PLACEMENT_CONFIG,
    ...value,
    rules: rules.map((rule) => ({
      ...rule,
      patterns: [...rule.patterns],
      allowedPatterns: [...rule.allowedPatterns],
      exceptions: [...(rule.exceptions ?? [])],
    })),
  };
}

function cloneUnitTestConfig(value = {}) {
  const mappings = value.mappings ?? DEFAULT_UNIT_TEST_CONFIG.mappings;
  return {
    ...DEFAULT_UNIT_TEST_CONFIG,
    ...value,
    sourcePatterns: [...(value.sourcePatterns ?? DEFAULT_UNIT_TEST_CONFIG.sourcePatterns)],
    testPatterns: [...(value.testPatterns ?? DEFAULT_UNIT_TEST_CONFIG.testPatterns)],
    mappings: mappings.map((mapping) => ({
      ...mapping,
      testTemplates: [...mapping.testTemplates],
    })),
    exclusions: [...(value.exclusions ?? DEFAULT_UNIT_TEST_CONFIG.exclusions)],
  };
}

export function createStarterConfig({
  buildEnabled = false,
  stylelintEnabled = false,
  typeCheckEnabled = false,
  unitTestEnabled = false,
} = {}) {
  return {
    $schema: CONFIG_SCHEMA_PATH,
    version: 1,
    notification: { ...DEFAULT_NOTIFICATION_CONFIG },
    build: {
      ...DEFAULT_BUILD_CONFIG,
      enabled: buildEnabled,
    },
    lighthouse: { ...DEFAULT_LIGHTHOUSE_CONFIG },
    typeCheck: {
      ...DEFAULT_TYPE_CHECK_CONFIG,
      enabled: typeCheckEnabled,
    },
    unitTest: cloneUnitTestConfig({ enabled: unitTestEnabled }),
    preCommit: {
      filePlacement: cloneFilePlacementConfig(),
      maxFileLines: {
        ...DEFAULT_MAX_FILE_LINES_CONFIG,
        enabled: true,
        rules: DEFAULT_MAX_FILE_LINES_CONFIG.rules.map((rule) => ({ ...rule })),
        exclusions: [...DEFAULT_MAX_FILE_LINES_CONFIG.exclusions],
      },
      stylelint: { ...DEFAULT_STYLELINT_CONFIG, enabled: stylelintEnabled },
      prettier: { ...DEFAULT_PRETTIER_CONFIG, enabled: true },
      eslint: { ...DEFAULT_ESLINT_CONFIG, enabled: true, preset: true },
    },
    rules: [
      { pattern: 'package.json', category: 'Dependencies and package metadata', level: 'notify' },
      { pattern: '**/package.json', category: 'Dependencies and package metadata', level: 'notify' },
      { pattern: 'package-lock.json', category: 'Dependency lock files', level: 'notify' },
      { pattern: '.env*', category: 'Environment configuration', level: 'notify' },
      { pattern: 'src/main.*', category: 'Application entry', level: 'notify' },
      { pattern: 'src/App.vue', category: 'Application entry', level: 'notify' },
      { pattern: 'src/components/**', category: 'Shared components', level: 'notify' },
      { pattern: '.githooks/**', category: 'Repository guard infrastructure', level: 'notify' },
      { pattern: CONFIG_FILE, category: 'Repository guard infrastructure', level: 'notify' },
    ],
    exclusions: [],
  };
}

function configPath(root) {
  return path.join(root, CONFIG_FILE);
}

function readProjectConfig(root) {
  try {
    return JSON.parse(readFileSync(configPath(root), 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${CONFIG_FILE}: ${error.message}`);
  }
}

function writeProjectConfig(root, value) {
  writeFileSync(configPath(root), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function ensureProjectConfig(root, options) {
  if (existsSync(configPath(root))) {
    return { created: false };
  }
  writeProjectConfig(root, createStarterConfig(options));
  return { created: true };
}

export function migrateProjectConfig(root) {
  const current = readProjectConfig(root);
  const prepared = { ...current, version: current.version ?? 1 };

  // Invalid values must fail before migration can rewrite the user's file.
  validateConfig(prepared);

  const preCommit = prepared.preCommit ?? {};
  const next = {
    $schema: prepared.$schema ?? CONFIG_SCHEMA_PATH,
    ...prepared,
    notification: {
      ...DEFAULT_NOTIFICATION_CONFIG,
      ...(prepared.notification ?? {}),
    },
    build: {
      ...DEFAULT_BUILD_CONFIG,
      ...(prepared.build ?? {}),
    },
    lighthouse: {
      ...DEFAULT_LIGHTHOUSE_CONFIG,
      ...(prepared.lighthouse ?? {}),
    },
    typeCheck: {
      ...DEFAULT_TYPE_CHECK_CONFIG,
      ...(prepared.typeCheck ?? {}),
    },
    unitTest: cloneUnitTestConfig(prepared.unitTest),
    preCommit: {
      ...preCommit,
      filePlacement: cloneFilePlacementConfig(preCommit.filePlacement),
      maxFileLines: {
        ...DEFAULT_MAX_FILE_LINES_CONFIG,
        ...(preCommit.maxFileLines ?? {}),
      },
      stylelint: {
        ...DEFAULT_STYLELINT_CONFIG,
        ...(preCommit.stylelint ?? {}),
      },
      prettier: {
        ...DEFAULT_PRETTIER_CONFIG,
        ...(preCommit.prettier ?? {}),
      },
      eslint: {
        ...DEFAULT_ESLINT_CONFIG,
        ...(preCommit.eslint ?? {}),
      },
    },
    exclusions: prepared.exclusions ?? [],
  };

  validateConfig(next);
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) {
    writeProjectConfig(root, next);
  }
  return { changed, config: next };
}

function featureConfig(config, feature) {
  if (
    feature === 'build'
    || feature === 'notification'
    || feature === 'lighthouse'
    || feature === 'typeCheck'
    || feature === 'unitTest'
  ) {
    return config[feature];
  }
  return config.preCommit[feature];
}

export function setFeaturesEnabled(root, requestedFeatures, enabled) {
  if (typeof enabled !== 'boolean') {
    throw new Error('Feature state must be a boolean');
  }
  const uniqueFeatures = [...new Set(requestedFeatures)];
  if (uniqueFeatures.length === 0) {
    throw new Error(`Choose at least one feature: ${CONFIGURABLE_FEATURES.join(', ')}`);
  }

  const unsupported = uniqueFeatures.filter(
    (feature) => !CONFIGURABLE_FEATURES.includes(feature),
  );
  if (unsupported.length > 0) {
    throw new Error(`Unsupported feature(s): ${unsupported.join(', ')}`);
  }

  const migration = migrateProjectConfig(root);
  const next = migration.config;
  const changed = [];
  const unchanged = [];

  for (const feature of uniqueFeatures) {
    const target = featureConfig(next, feature);
    if (target.enabled === enabled) {
      unchanged.push(feature);
    } else {
      target.enabled = enabled;
      changed.push(feature);
    }
  }

  validateConfig(next);
  if (changed.length > 0) {
    writeProjectConfig(root, next);
  }
  return {
    changed,
    migrated: migration.changed,
    targetEnabled: enabled,
    unchanged,
  };
}

export function enableQualityGates(root, requestedGates) {
  const unsupported = requestedGates.filter((gate) => !QUALITY_GATES.includes(gate));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported quality gate(s): ${unsupported.join(', ')}`);
  }
  const result = setFeaturesEnabled(root, requestedGates, true);
  return {
    alreadyEnabled: result.unchanged,
    enabled: result.changed,
    migrated: result.migrated,
  };
}
