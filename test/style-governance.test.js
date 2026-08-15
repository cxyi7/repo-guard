import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectUnexpectedGlobalStyles } from '../src/style-governance.js';
import { runStyleGovernanceProject } from '../src/gates/quality/stylelint-gate.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function fixture(context) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'style-governance-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'styles'), { recursive: true });
  return root;
}

test('detects unscoped Vue blocks and explicit global escapes', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'src', 'components', 'Panel.vue');
  writeFileSync(file, [
    '<template><div class="panel" /></template>',
    '<style>.panel { color: red; }</style>',
    '<style scoped>.panel :global(body) { margin: 0; } .panel ::v-global(html) { padding: 0; }</style>',
    '',
  ].join('\n'));

  const results = inspectUnexpectedGlobalStyles({
    root,
    files: [file],
    allowedPatterns: ['src/styles/**'],
  });
  assert.equal(results[0].warnings.length, 3);
  assert.deepEqual(
    results[0].warnings.map(({ rule }) => rule),
    [
      'no-unexpected-global-style',
      'no-unexpected-global-style',
      'no-unexpected-global-style',
    ],
  );
});

test('allows scoped, module, CSS Modules, and approved global files', (context) => {
  const root = fixture(context);
  const files = [
    ['src/components/Scoped.vue', '<style scoped>.a { color: red; }</style>\n'],
    ['src/components/Module.vue', '<style module>.a { color: red; }</style>\n'],
    ['src/components/panel.module.css', '.panel { color: red; }\n'],
    ['src/styles/reset.css', 'html { color: black; }\n'],
  ].map(([relative, content]) => {
    const file = path.join(root, relative);
    writeFileSync(file, content);
    return file;
  });

  assert.deepEqual(inspectUnexpectedGlobalStyles({
    root,
    files,
    allowedPatterns: ['src/styles/**'],
  }), []);
});

test('does not treat comment text as a global escape', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'src', 'components', 'Comment.vue');
  writeFileSync(
    file,
    '<style scoped>/* :global(body) */\n.comment { color: red; }</style>\n',
  );

  assert.deepEqual(inspectUnexpectedGlobalStyles({
    root,
    files: [file],
    allowedPatterns: ['src/styles/**'],
  }), []);
});

test('does not treat style examples in SFC comments or scripts as real blocks', (context) => {
  const root = fixture(context);
  const file = path.join(root, 'src', 'components', 'Examples.vue');
  writeFileSync(file, [
    '<template><p class="example" /></template>',
    '<!-- <style>.fake { color: red; }</style> -->',
    '<script setup>const example = "<style>.fake { color: red; }</style>";</script>',
    '<style scoped>.example { color: green; }</style>',
    '',
  ].join('\n'));

  assert.deepEqual(inspectUnexpectedGlobalStyles({
    root,
    files: [file],
    allowedPatterns: ['src/styles/**'],
  }), []);
});

test('explicit CLI audits ignored files while the staged enhancement is disabled', (context) => {
  const root = fixture(context);
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'stylelint.config.mjs'), 'export default { rules: {} };\n');
  writeFileSync(path.join(root, '.stylelintignore'), 'src/components/unsafe.css\n');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      preCommit: {
        stylelint: {
          enabled: true,
          governance: {
            enabled: false,
            maxSpecificity: '0,3,0',
            maxIdSelectors: 0,
            disallowImportant: true,
            allowedGlobalStylePatterns: ['src/styles/**'],
          },
        },
      },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'src', 'components', 'unsafe.css'), '#app { color: red; }\n');

  const result = spawnSync(process.execPath, [CLI_PATH, 'style-governance'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /style\/selector-max-id/);
  assert.match(result.stderr, /style\/no-unexpected-global-style/);
});

test('allows only an exact active structured governance exception', async (context) => {
  const root = fixture(context);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'stylelint.config.mjs'), 'export default { rules: {} };\n');
  const file = path.join(root, 'src', 'components', 'legacy.css');
  writeFileSync(file, '.legacy { color: red; }\n');
  const createdOn = new Date(Date.now() - (24 * 60 * 60 * 1000))
    .toISOString().slice(0, 10);
  const expiresOn = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
    .toISOString().slice(0, 10);

  const result = await runStyleGovernanceProject({
    root,
    files: [file],
    config: {
      enabled: true,
      maxSpecificity: '0,3,0',
      maxIdSelectors: 0,
      disallowImportant: true,
      allowedGlobalStylePatterns: ['src/styles/**'],
    },
    exceptions: {
      warningDays: 14,
      maxDays: 90,
      entries: [{
        id: 'legacy-global-style',
        rule: 'style/no-unexpected-global-style',
        path: 'src/components/legacy.css',
        line: 1,
        column: 1,
        reason: 'Legacy stylesheet awaits reviewed CSS Module migration.',
        owner: 'frontend-team',
        approvedBy: 'architecture-team',
        ticket: 'STYLE-2000',
        createdOn,
        expiresOn,
      }],
    },
  });
  assert.equal(result.status, 'passed');
});
