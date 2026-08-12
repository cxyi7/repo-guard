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
import { loadConfig } from '../src/config.js';
import {
  assertExceptionRegistryCurrent,
  findStructuredException,
  formatExceptionRegistryReport,
  inspectExceptionRegistry,
} from '../src/exception-registry.js';
import {
  ensureExceptionPolicy,
  isExceptionPolicyCurrent,
} from '../src/exception-policy.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function entry(extra = {}) {
  return {
    id: 'legacy-renderer',
    rule: 'security/no-unsafe-html',
    path: 'src/components/LegacyPanel.vue',
    line: 12,
    column: 7,
    reason: 'Legacy trusted renderer awaiting replacement.',
    owner: 'frontend-team',
    approvedBy: 'security-team',
    ticket: 'SEC-1234',
    createdOn: '2026-08-01',
    expiresOn: '2026-08-31',
    ...extra,
  };
}

function registry(entries = [entry()]) {
  return { warningDays: 14, maxDays: 90, entries };
}

function dateText(offsetDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function createFixture(entries) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'exceptions-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: { warningDays: 14, maxDays: 90, entries },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('classifies active, expiring, expired, and future-dated exceptions', () => {
  const result = inspectExceptionRegistry(registry([
    entry({ id: 'active', expiresOn: '2026-09-20' }),
    entry({ id: 'expiring', line: 13, expiresOn: '2026-08-20' }),
    entry({ id: 'expired', line: 14, expiresOn: '2026-08-10' }),
    entry({
      id: 'future',
      line: 15,
      createdOn: '2026-08-12',
      expiresOn: '2026-08-30',
    }),
  ]), { now: new Date('2026-08-11T10:00:00Z') });

  assert.deepEqual(result.entries.map(({ status }) => status), [
    'active',
    'expiring',
    'expired',
    'future',
  ]);
  assert.match(formatExceptionRegistryReport(result), /legacy-renderer|active/);
  assert.throws(
    () => assertExceptionRegistryCurrent(registry(result.entries), {
      now: new Date('2026-08-11T10:00:00Z'),
    }),
    /future-dated entries are invalid/,
  );
});

test('matches only an exact, currently valid finding location', () => {
  const config = registry();
  const options = { now: new Date('2026-08-11T10:00:00Z') };
  assert.equal(findStructuredException(config, {
    rule: 'security/no-unsafe-html',
    path: 'src\\components\\LegacyPanel.vue',
    line: 12,
    column: 7,
  }, options)?.id, 'legacy-renderer');
  assert.equal(findStructuredException(config, {
    rule: 'security/no-unsafe-html',
    path: 'src/components/LegacyPanel.vue',
    line: 13,
    column: 7,
  }, options), null);
});

test('loadConfig blocks expired entries while the report CLI can explain them', (context) => {
  const expired = entry({
    createdOn: dateText(-30),
    expiresOn: dateText(-1),
  });
  const root = createFixture([expired]);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(() => loadConfig(root), /Expired exceptions/);
  const result = spawnSync(process.execPath, [CLI_PATH, 'exceptions'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /legacy-renderer/);
  assert.match(result.stderr, /expired/);
});

test('reports active entries and maintains an idempotent AI policy', (context) => {
  const active = entry({
    createdOn: dateText(-1),
    expiresOn: dateText(30),
  });
  const root = createFixture([active]);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'AGENTS.md'), '# Existing rules\n');

  const cliResult = spawnSync(process.execPath, [CLI_PATH, 'exceptions'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /1 active/);

  const config = loadConfig(root).exceptions;
  assert.equal(ensureExceptionPolicy(root, config).changed, true);
  const content = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(ensureExceptionPolicy(root, config).changed, false);
  assert.equal(isExceptionPolicyCurrent(content, config), true);
  assert.match(content, /AI 不得自行新增例外/);
  assert.match(content, /Vue 模板禁止使用 `v-html`/);
  assert.match(content, /target="_blank"/);
  assert.match(content, /原生表单控件必须具有可静态验证/);
  assert.match(content, /依赖必须遵守精确版本/);
  assert.match(content, /样式复杂度门禁/);
});
