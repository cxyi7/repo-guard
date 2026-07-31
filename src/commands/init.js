import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from '../config.js';
import { findRepositoryRoot } from '../git.js';
import { installHooks } from '../hook-installer.js';

const STARTER_CONFIG = {
  $schema: './node_modules/@cxyi7/repo-guard/config.schema.json',
  version: 1,
  preCommit: {
    eslint: {
      enabled: false,
      pattern: '*.{js,jsx,ts,tsx,vue}',
      fix: true,
      maxWarnings: 0,
    },
  },
  rules: [
    {
      pattern: 'package.json',
      category: 'Dependencies and package metadata',
      level: 'notify',
    },
    {
      pattern: '**/package.json',
      category: 'Dependencies and package metadata',
      level: 'notify',
    },
    {
      pattern: 'package-lock.json',
      category: 'Dependency lock files',
      level: 'notify',
    },
    {
      pattern: '.env*',
      category: 'Environment configuration',
      level: 'notify',
    },
    {
      pattern: 'src/main.*',
      category: 'Application entry',
      level: 'notify',
    },
    {
      pattern: 'src/App.vue',
      category: 'Application entry',
      level: 'notify',
    },
    {
      pattern: 'src/components/**',
      category: 'Shared components',
      level: 'notify',
    },
    {
      pattern: '.githooks/**',
      category: 'Repository guard infrastructure',
      level: 'notify',
    },
    {
      pattern: CONFIG_FILE,
      category: 'Repository guard infrastructure',
      level: 'notify',
    },
  ],
  exclusions: [],
};

function ensureStarterConfig(root) {
  const target = path.join(root, CONFIG_FILE);
  if (existsSync(target)) {
    return false;
  }
  writeFileSync(target, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`, 'utf8');
  return true;
}

export function runInit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const configCreated = ensureStarterConfig(root);
  const result = installHooks({
    cwd: root,
    updatePackageScripts: true,
  });

  console.log(`repo-guard initialized in ${root}`);
  console.log(`- hooks path: ${result.hooksPath}`);
  console.log(`- hooks: ${result.hooks.join(', ')}`);
  console.log(`- .gitattributes: ${result.gitAttributes.changed ? 'updated' : 'preserved'}`);
  console.log(
    `- .gitignore: ${result.localEnvironment.gitIgnore.changed ? 'updated' : 'preserved'}`,
  );
  console.log(
    `- .env.config: ${result.localEnvironment.envFile.created ? 'created' : 'preserved'}`,
  );
  console.log(`- config: ${CONFIG_FILE}${configCreated ? ' (created)' : ' (preserved)'}`);
  console.log('- run "repo-guard doctor" after configuring notification environment variables');
  return 0;
}

export function runInstallHooks(cwd = process.cwd()) {
  const result = installHooks({
    cwd,
    updatePackageScripts: false,
    allowMissingGit: true,
  });
  if (!result.skipped) {
    console.log(`repo-guard hooks installed in ${result.root}`);
  }
  return 0;
}
