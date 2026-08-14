import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runStyleComplexityProject } from '../src/stylelint-runner.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function createFixture() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'style-complexity-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'stylelint.config.mjs'),
    'export default { rules: { "selector-max-compound-selectors": null } };\n',
  );
  writeFileSync(path.join(root, '.stylelintignore'), 'style.css\n');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      preCommit: {
        stylelint: {
          enabled: true,
          complexity: {
            enabled: false,
            maxCompoundSelectors: 2,
            maxNestingDepth: 2,
          },
        },
      },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'style.css'),
    '/* stylelint-disable selector-max-compound-selectors */\n.page .panel .action { color: red; }\n',
  );
  git(root, ['add', '.']);
  return root;
}

function exceptionRegistry(entries = []) {
  return { warningDays: 14, maxDays: 90, entries };
}

test('explicit CLI audits ignored files even when the staged gate is disabled', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'style-complexity'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /style\/selector-max-compound-selectors/);
  assert.match(result.stderr, /\[style\/selector-max-compound-selectors\] style\.css:2:1/);
  assert.match(result.stderr, /Remediation:/);
});

test('allows only an exact active structured exception', async (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const expiresOn = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
    .toISOString().slice(0, 10);
  const createdOn = new Date(Date.now() - (24 * 60 * 60 * 1000))
    .toISOString().slice(0, 10);

  const result = await runStyleComplexityProject({
    root,
    files: ['style.css'],
    config: {
      enabled: true,
      maxCompoundSelectors: 2,
      maxNestingDepth: 2,
    },
    exceptions: exceptionRegistry([{
      id: 'legacy-selector-chain',
      rule: 'style/selector-max-compound-selectors',
      path: 'style.css',
      line: 2,
      column: 1,
      reason: 'Legacy selector awaits a reviewed component markup migration.',
      owner: 'frontend-team',
      approvedBy: 'architecture-team',
      ticket: 'STYLE-1000',
      createdOn,
      expiresOn,
    }]),
  });
  assert.equal(result.status, 'passed');
});
