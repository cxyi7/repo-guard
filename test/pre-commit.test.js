import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runPreCommit } from '../src/commands/pre-commit.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function normalizeEol(value) {
  return value.replace(/\r\n/g, '\n');
}

function writeConfig(root, { enabled = true, pattern = '*.js' } = {}) {
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      preCommit: {
        eslint: {
          enabled,
          pattern,
          fix: true,
          maxWarnings: 0,
        },
      },
      rules: [
        {
          pattern: '**',
          category: 'Test fixture',
          level: 'audit',
        },
      ],
      exclusions: [],
    }, null, 2)}\n`,
  );
}

function createRepository(options) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'pre-commit-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'eslint.config.mjs'),
    [
      'export default [',
      '  {',
      '    ignores: ["ignored.js"],',
      '  },',
      '  {',
      '    files: ["**/*.js"],',
      '    rules: { semi: ["error", "always"] },',
      '  },',
      '];',
      '',
    ].join('\n'),
  );
  writeConfig(root, options);
  return root;
}

function commitBaseline(root, content = 'const value = 1;\n') {
  writeFileSync(path.join(root, 'sample.js'), content);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'test: baseline']);
}

test('auto-fixes only staged content and restores unstaged edits', async (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitBaseline(root);

  writeFileSync(path.join(root, 'sample.js'), 'const value = 2\n');
  git(root, ['add', 'sample.js']);
  writeFileSync(
    path.join(root, 'sample.js'),
    'const value = 2\nconst localOnly = 3\n',
  );

  assert.equal(await runPreCommit(root), 0);
  assert.equal(normalizeEol(git(root, ['show', ':sample.js'])), 'const value = 2;\n');

  const worktree = readFileSync(path.join(root, 'sample.js'), 'utf8');
  assert.match(worktree, /^const value = 2;/);
  assert.match(worktree, /const localOnly = 3/);
  assert.doesNotMatch(git(root, ['show', ':sample.js']), /localOnly/);
});

test('blocks unfixable syntax errors without committing partial fixes', async (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitBaseline(root);

  const invalid = 'const = ;\n';
  writeFileSync(path.join(root, 'sample.js'), invalid);
  git(root, ['add', 'sample.js']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':sample.js'])), invalid);
  assert.equal(
    normalizeEol(readFileSync(path.join(root, 'sample.js'), 'utf8')),
    invalid,
  );
});

test('restores fixes on a failing initial commit without a Git stash', async (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const fixable = 'const fixable = 1\n';
  const invalid = 'const = ;\n';
  writeFileSync(path.join(root, 'fixable.js'), fixable);
  writeFileSync(path.join(root, 'broken.js'), invalid);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(
    normalizeEol(readFileSync(path.join(root, 'fixable.js'), 'utf8')),
    fixable,
  );
  assert.equal(
    normalizeEol(git(root, ['show', ':fixable.js'])),
    fixable,
  );
});

test('lets the project disable the ESLint gate explicitly', async (context) => {
  const root = createRepository({ enabled: false });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitBaseline(root);

  const invalid = 'const = ;\n';
  writeFileSync(path.join(root, 'sample.js'), invalid);
  git(root, ['add', 'sample.js']);

  assert.equal(await runPreCommit(root), 0);
  assert.equal(normalizeEol(git(root, ['show', ':sample.js'])), invalid);
});

test('does not block files ignored by the project ESLint configuration', async (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const ignored = 'const = ;\n';
  writeFileSync(path.join(root, 'ignored.js'), ignored);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 0);
  assert.equal(normalizeEol(git(root, ['show', ':ignored.js'])), ignored);
});
