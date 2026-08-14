import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  inspectDependencyPolicy,
  inspectStagedDependencyPolicy,
} from '../src/gates/repository/dependency-policy.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function policy(extra = {}) {
  return {
    requireExactVersions: true,
    requireLockfile: true,
    allowedProtocols: ['npm', 'workspace'],
    bannedPackages: [],
    ...extra,
  };
}

function registry(entries = []) {
  return { warningDays: 14, maxDays: 90, entries };
}

function dateText(offsetDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function createFixture(packageJson, lockRoot = null, dependencyPolicy = policy()) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'dependency-policy-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  if (lockRoot) {
    writeFileSync(
      path.join(root, 'package-lock.json'),
      `${JSON.stringify({
        name: packageJson.name,
        version: packageJson.version,
        lockfileVersion: 3,
        requires: true,
        packages: { '': lockRoot },
      }, null, 2)}\n`,
    );
  }
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      dependencyPolicy,
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('enforces exact versions, approved sources, bans, grouping, and lock consistency', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: {
      axios: '^1.7.0',
      lodash: 'https://example.invalid/lodash.tgz',
      request: '2.88.2',
      vue: '3.5.0',
    },
    devDependencies: {
      vue: '3.5.0',
      eslint: '9.39.5',
    },
    peerDependencies: {
      pluginApi: '^2.0.0',
    },
  };
  const root = createFixture(packageJson, {
    name: 'fixture',
    version: '1.0.0',
    dependencies: {
      axios: '^1.7.0',
      lodash: 'https://example.invalid/lodash.tgz',
      request: '2.88.2',
      vue: '3.4.0',
    },
    devDependencies: { vue: '3.5.0', eslint: '9.39.5' },
  }, policy({
    bannedPackages: [{
      name: 'request',
      reason: 'Package is deprecated and unmaintained.',
      replacement: 'undici',
    }],
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = inspectDependencyPolicy({
    root,
    config: policy({
      bannedPackages: [{
        name: 'request',
        reason: 'Package is deprecated and unmaintained.',
        replacement: 'undici',
      }],
    }),
    exceptions: registry(),
  });
  assert.deepEqual(new Set(result.violations.map(({ rule }) => rule)), new Set([
    'dependencies/non-exact-version',
    'dependencies/disallowed-source',
    'dependencies/banned-package',
    'dependencies/duplicate-declaration',
    'dependencies/lockfile-mismatch',
  ]));
  assert.equal(result.violations.some(({ dependency }) => dependency === 'pluginApi'), false);
  assert.equal(result.violations.every(({ line, column }) => line > 0 && column > 0), true);
});

test('accepts exact npm aliases and workspace dependencies with a synchronized lockfile', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: {
      internal: 'workspace:*',
      legacyVue: 'npm:vue@3.5.0',
      vue: '3.5.0',
    },
  };
  const root = createFixture(packageJson, {
    name: 'fixture',
    version: '1.0.0',
    dependencies: packageJson.dependencies,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(inspectDependencyPolicy({
    root,
    config: policy(),
    exceptions: registry(),
  }).violations.length, 0);
});

test('still rejects unapproved sources when exact-version enforcement is disabled', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: { axios: 'https://example.invalid/axios.tgz' },
    devDependencies: { shorthand: 'owner/repository#main' },
    peerDependencies: { pluginApi: 'git+https://example.invalid/plugin.git' },
  };
  const root = createFixture(packageJson, null, policy({
    requireExactVersions: false,
    requireLockfile: false,
  }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = inspectDependencyPolicy({
    root,
    config: policy({ requireExactVersions: false, requireLockfile: false }),
    exceptions: registry(),
  });
  assert.deepEqual(
    result.violations.map(({ rule }) => rule),
    [
      'dependencies/disallowed-source',
      'dependencies/disallowed-source',
      'dependencies/disallowed-source',
    ],
  );
});

test('ignores invalid staged lock metadata when lockfile enforcement is disabled', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: { axios: '1.7.0' },
  };
  const dependencyPolicy = policy({ requireLockfile: false });
  const root = createFixture(packageJson, null, dependencyPolicy);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package-lock.json'), '{ invalid json\n');
  const staged = spawnSync('git', ['add', 'package.json', 'package-lock.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(staged.status, 0, staged.stderr);

  assert.deepEqual(inspectStagedDependencyPolicy({
    root,
    config: dependencyPolicy,
    exceptions: registry(),
  }), { approved: [], violations: [] });
});

test('reports the exact root declaration when a package name also appears in scripts', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    scripts: { axios: 'echo nested-key' },
    dependencies: { axios: '^1.7.0' },
  };
  const root = createFixture(packageJson, null, policy({ requireLockfile: false }));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = inspectDependencyPolicy({
    root,
    config: policy({ requireLockfile: false }),
    exceptions: registry(),
  });
  assert.equal(result.violations[0].line, 8);
});

test('requires an exact active exception for a dependency violation', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: { axios: '^1.7.0' },
  };
  const root = createFixture(packageJson, {
    name: 'fixture',
    version: '1.0.0',
    dependencies: packageJson.dependencies,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const denied = inspectDependencyPolicy({ root, config: policy(), exceptions: registry() });
  const [finding] = denied.violations;
  const exception = {
    id: 'legacy-axios-range',
    rule: finding.rule,
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason: 'Legacy range awaits coordinated application upgrade.',
    owner: 'frontend-team',
    approvedBy: 'security-team',
    ticket: 'DEP-1000',
    createdOn: dateText(-1),
    expiresOn: dateText(30),
  };

  const approved = inspectDependencyPolicy({
    root,
    config: policy(),
    exceptions: registry([exception]),
  });
  assert.equal(approved.violations.length, 0);
  assert.equal(approved.approved[0].exception.id, 'legacy-axios-range');
});

test('exposes dependency governance through the CLI', (context) => {
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: { axios: '^1.7.0' },
  };
  const root = createFixture(packageJson, {
    name: 'fixture',
    version: '1.0.0',
    dependencies: packageJson.dependencies,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'dependencies'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /dependencies\/non-exact-version/);
  assert.match(result.stderr, /npm install --package-lock-only/);
  assert.match(readFileSync(path.join(root, 'package.json'), 'utf8'), /\^1\.7\.0/);
});
