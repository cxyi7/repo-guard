import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathNamingGate } from '../src/gates/repository/path-naming-gate.js';
import { inspectPathNaming } from '../src/policies/path-naming.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function config(convention, overrides = {}) {
  return {
    enabled: true,
    convention,
    include: ['src/**', 'utils/**'],
    exclude: [],
    ...overrides,
  };
}

function runGit(root, argumentsList) {
  const result = spawnSync('git', argumentsList, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

test('enforces camelCase for every included file and directory', () => {
  const result = inspectPathNaming({
    files: [
      'src/committeeInfo/committeeInfo.service.ts',
      'src/committee-info/committeeInfo.ts',
      'src/UserInfo.ts',
      'utils/user_info.ts',
    ],
    config: config('camelCase'),
  });

  assert.deepEqual(
    result.violations.map(({ path: pathname, name, kind }) => ({ pathname, name, kind })),
    [
      { pathname: 'src/committee-info', name: 'committee-info', kind: 'directory' },
      { pathname: 'src/UserInfo.ts', name: 'UserInfo', kind: 'file' },
      { pathname: 'utils/user_info.ts', name: 'user_info', kind: 'file' },
    ],
  );
});

test('enforces kebab-case for the same configured scope', () => {
  const result = inspectPathNaming({
    files: [
      'src/committee-info/committee-info.service.ts',
      'src/committeeInfo/committee-info.ts',
      'utils/userInfo.ts',
    ],
    config: config('kebab-case'),
  });

  assert.deepEqual(
    result.violations.map(({ path: pathname, name, kind }) => ({ pathname, name, kind })),
    [
      { pathname: 'src/committeeInfo', name: 'committeeInfo', kind: 'directory' },
      { pathname: 'utils/userInfo.ts', name: 'userInfo', kind: 'file' },
    ],
  );
});

test('allows neutral single words and applies include and exclude before checking names', () => {
  const result = inspectPathNaming({
    files: [
      'src/index.ts',
      'utils/format.ts',
      'src/generated/Bad_Name.ts',
      'components/BadName.vue',
    ],
    config: config('kebab-case', {
      exclude: ['src/generated/**'],
    }),
  });

  assert.equal(result.checkedFiles, 2);
  assert.deepEqual(result.violations, []);
});

test('checks every dot-separated logical file name segment', () => {
  const result = inspectPathNaming({
    files: [
      'src/committee-info.BadSuffix.ts',
      'src/committee-info.test.ts',
    ],
    config: config('kebab-case'),
  });

  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].name, 'BadSuffix');
});

test('pre-commit plans the complete tracked scope instead of only staged input', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'path-naming-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'legacy-name.ts'), 'export {}\n');
  writeFileSync(path.join(root, 'src', 'currentName.ts'), 'export {}\n');
  writeFileSync(path.join(root, 'src', 'deleted-name.ts'), 'export {}\n');
  writeFileSync(path.join(root, 'src', 'untracked-name.ts'), 'export {}\n');
  runGit(root, ['init']);
  runGit(root, ['add', 'src/legacy-name.ts', 'src/currentName.ts', 'src/deleted-name.ts']);
  runGit(root, ['rm', '--cached', 'src/deleted-name.ts']);

  const featureConfig = config('camelCase');
  const gateConfig = { preCommit: { pathNaming: featureConfig } };
  const plan = pathNamingGate.plan({
    root,
    config: gateConfig,
    environment: 'pre-commit',
    files: [path.join(root, 'src', 'currentName.ts')],
  });
  const result = pathNamingGate.run({ config: gateConfig, plan });

  assert.deepEqual([...plan.files].sort(), ['src/currentName.ts', 'src/legacy-name.ts']);
  assert.equal(result.status, 'violation');
  assert.equal(result.findings[0].ruleId, 'repository/path-naming');
  assert.equal(result.findings[0].severity, 'error');
});

test('manual command audits the supplied project scope even while disabled', () => {
  const featureConfig = { ...config('camelCase'), enabled: false };
  const gateConfig = { preCommit: { pathNaming: featureConfig } };
  const plan = pathNamingGate.plan({
    root: process.cwd(),
    config: gateConfig,
    environment: 'manual',
    files: ['src/committee-info.ts'],
  });
  const result = pathNamingGate.run({ config: gateConfig, plan });

  assert.equal(plan.enabled, true);
  assert.equal(result.status, 'violation');
});
