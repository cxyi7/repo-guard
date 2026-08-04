import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE,
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  validateConfig,
} from './config.js';

export const CONFIG_SCHEMA_PATH = './node_modules/@cxyi7/repo-guard/config.schema.json';
export const QUALITY_GATES = Object.freeze(['eslint', 'prettier']);

export function createStarterConfig() {
  return {
    $schema: CONFIG_SCHEMA_PATH,
    version: 1,
    preCommit: {
      prettier: { ...DEFAULT_PRETTIER_CONFIG, enabled: true },
      eslint: { ...DEFAULT_ESLINT_CONFIG, enabled: true },
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

export function ensureProjectConfig(root) {
  if (existsSync(configPath(root))) {
    return { created: false };
  }
  writeProjectConfig(root, createStarterConfig());
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
    preCommit: {
      ...preCommit,
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

export function enableQualityGates(root, requestedGates) {
  const uniqueGates = [...new Set(requestedGates)];
  if (uniqueGates.length === 0) {
    throw new Error(`Choose at least one quality gate: ${QUALITY_GATES.join(', ')}`);
  }

  const unsupported = uniqueGates.filter((gate) => !QUALITY_GATES.includes(gate));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported quality gate(s): ${unsupported.join(', ')}`);
  }

  const migration = migrateProjectConfig(root);
  const next = migration.config;
  const enabled = [];
  const alreadyEnabled = [];

  for (const gate of uniqueGates) {
    if (next.preCommit[gate].enabled) {
      alreadyEnabled.push(gate);
    } else {
      next.preCommit[gate].enabled = true;
      enabled.push(gate);
    }
  }

  validateConfig(next);
  if (enabled.length > 0) {
    writeProjectConfig(root, next);
  }
  return { alreadyEnabled, enabled, migrated: migration.changed };
}
