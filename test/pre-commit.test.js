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

function writeConfig(root, {
  enabled = true,
  eslintPreset = false,
  pattern = '*.js',
  prettierEnabled = false,
  prettierPattern = '*.{js,json,css}',
  prettierFix = true,
  prettierRequireConfig = true,
  stylelintEnabled = false,
  stylelintFix = true,
  stylelintPattern = '**/*.{css,scss,sass,less,vue}',
  stylelintRequireConfig = true,
  styleComplexityEnabled = false,
  styleMaxCompoundSelectors = 3,
  styleMaxNestingDepth = 3,
  dependencyPolicyEnabled = false,
  maxFileLinesEnabled = false,
  filePlacementEnabled = false,
  filePlacementMode = 'newFiles',
  filePlacementRules = [{
    name: 'Assets',
    patterns: ['**/*.{png,svg}'],
    allowedPatterns: ['src/assets/**'],
    exceptions: [],
    suggestedDirectory: 'src/assets',
  }],
  maxFileLineRules = [
    { pattern: '**/*.vue', maxLines: 700 },
    { pattern: '**/*.js', maxLines: 1000 },
  ],
} = {}) {
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      dependencyPolicy: {
        enabled: dependencyPolicyEnabled,
        requireExactVersions: true,
        requireLockfile: true,
        allowedProtocols: ['npm', 'workspace'],
        bannedPackages: [],
      },
      preCommit: {
        filePlacement: {
          enabled: filePlacementEnabled,
          mode: filePlacementMode,
          rules: filePlacementRules,
        },
        maxFileLines: {
          enabled: maxFileLinesEnabled,
          rules: maxFileLineRules,
          exclusions: [],
        },
        stylelint: {
          enabled: stylelintEnabled,
          pattern: stylelintPattern,
          fix: stylelintFix,
          maxWarnings: 0,
          requireConfig: stylelintRequireConfig,
          complexity: {
            enabled: styleComplexityEnabled,
            maxCompoundSelectors: styleMaxCompoundSelectors,
            maxNestingDepth: styleMaxNestingDepth,
          },
        },
        prettier: {
          enabled: prettierEnabled,
          pattern: prettierPattern,
          fix: prettierFix,
          requireConfig: prettierRequireConfig,
        },
        eslint: {
          enabled,
          preset: eslintPreset,
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

function createRepository(options = {}) {
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
      '    languageOptions: { globals: { console: "readonly" } },',
      `    rules: ${JSON.stringify({
        semi: ['error', 'always'],
        ...(options.eslintRules ?? {}),
      })},`,
      '  },',
      '];',
      '',
    ].join('\n'),
  );
  if (options.prettierConfig !== null) {
    writeFileSync(
      path.join(root, '.prettierrc.json'),
      `${JSON.stringify(options.prettierConfig || {
        semi: true,
        singleQuote: true,
      }, null, 2)}\n`,
    );
  }
  if (options.stylelintConfig) {
    writeFileSync(
      path.join(root, 'stylelint.config.mjs'),
      `export default ${JSON.stringify(options.stylelintConfig, null, 2)};\n`,
    );
  }
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

test('automatically applies the repo-guard ESLint preset from the JSON switch', async (context) => {
  const root = createRepository({ eslintPreset: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'sample.js'), 'console.log("automatic");\n');
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(
    normalizeEol(git(root, ['show', ':sample.js'])),
    'console.log("automatic");\n',
  );
});

test('lets the project ESLint config override the automatic preset', async (context) => {
  const root = createRepository({
    eslintPreset: true,
    eslintRules: { 'no-console': 'off' },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'sample.js'), 'console.log("project override");\n');
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 0);
});

test('checks the staged file line count and ignores unstaged lines', async (context) => {
  const root = createRepository({
    enabled: false,
    maxFileLinesEnabled: true,
    maxFileLineRules: [{ pattern: '**/*.js', maxLines: 2 }],
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'sample.js'), 'const one = 1;\nconst two = 2;\n');
  git(root, ['add', '.']);
  writeFileSync(
    path.join(root, 'sample.js'),
    'const one = 1;\nconst two = 2;\nconst unstaged = 3;\n',
  );

  assert.equal(await runPreCommit(root), 0);
  assert.doesNotMatch(git(root, ['show', ':sample.js']), /unstaged/);

  git(root, ['add', 'sample.js']);
  assert.equal(await runPreCommit(root), 1);
});

test('blocks newly staged resources outside configured asset folders', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: true,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  commitBaseline(root);

  mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'components', 'logo.png'), 'fixture');
  git(root, ['add', 'src/components/logo.png']);

  assert.equal(await runPreCommit(root), 1);
  assert.match(git(root, ['show', ':src/components/logo.png']), /fixture/);
});

test('does not block modified legacy resources in newFiles mode', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: true,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'components', 'legacy.png'), 'baseline');
  commitBaseline(root);

  writeFileSync(path.join(root, 'src', 'components', 'legacy.png'), 'updated');
  git(root, ['add', 'src/components/legacy.png']);

  assert.equal(await runPreCommit(root), 0);
  assert.match(git(root, ['show', ':src/components/legacy.png']), /updated/);
});

test('does not block files ignored by the project ESLint configuration', async (context) => {
  const root = createRepository({ eslintPreset: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const ignored = 'const = ;\n';
  writeFileSync(path.join(root, 'ignored.js'), ignored);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 0);
  assert.equal(normalizeEol(git(root, ['show', ':ignored.js'])), ignored);
});

test('formats staged code and non-code files with project Prettier rules', async (context) => {
  const root = createRepository({ prettierEnabled: true });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'sample.js'), 'const value={answer:42}\n');
  writeFileSync(path.join(root, 'data.json'), '{"answer":42}\n');
  writeFileSync(path.join(root, 'style.css'), '.sample{color:red}\n');
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 0);
  assert.equal(
    normalizeEol(git(root, ['show', ':sample.js'])),
    "const value = { answer: 42 };\n",
  );
  assert.equal(
    normalizeEol(git(root, ['show', ':data.json'])),
    '{ "answer": 42 }\n',
  );
  assert.equal(
    normalizeEol(git(root, ['show', ':style.css'])),
    '.sample {\n  color: red;\n}\n',
  );
});

test('formats only staged content and restores unstaged Prettier edits', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: true,
    prettierPattern: '*.css',
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'style.css'), '.sample {\n  color: red;\n}\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'test: baseline']);

  writeFileSync(path.join(root, 'style.css'), '.sample{color:blue}\n');
  git(root, ['add', 'style.css']);
  writeFileSync(
    path.join(root, 'style.css'),
    '.sample{color:blue}\n.local{color:red}\n',
  );

  assert.equal(await runPreCommit(root), 0);
  assert.equal(
    normalizeEol(git(root, ['show', ':style.css'])),
    '.sample {\n  color: blue;\n}\n',
  );
  assert.match(readFileSync(path.join(root, 'style.css'), 'utf8'), /\.local/);
  assert.doesNotMatch(git(root, ['show', ':style.css']), /\.local/);
});

test('honors the project Prettier ignore file', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: true,
    prettierPattern: '*.css',
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const ignored = '.ignored{color:red}\n';
  writeFileSync(path.join(root, '.prettierignore'), 'ignored.css\n');
  writeFileSync(path.join(root, 'ignored.css'), ignored);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 0);
  assert.equal(normalizeEol(git(root, ['show', ':ignored.css'])), ignored);
});

test('blocks formatting when required project Prettier config is missing', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierConfig: null,
    prettierEnabled: true,
    prettierPattern: '*.css',
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const unformatted = '.sample{color:red}\n';
  writeFileSync(path.join(root, 'style.css'), unformatted);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':style.css'])), unformatted);
  assert.equal(normalizeEol(readFileSync(path.join(root, 'style.css'), 'utf8')), unformatted);
});

test('blocks unformatted staged files when Prettier fixes are disabled', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: true,
    prettierFix: false,
    prettierPattern: '*.css',
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const unformatted = '.sample{color:red}\n';
  writeFileSync(path.join(root, 'style.css'), unformatted);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':style.css'])), unformatted);
  assert.equal(normalizeEol(readFileSync(path.join(root, 'style.css'), 'utf8')), unformatted);
});

test('rolls back the whole quality pipeline when Prettier conflicts with ESLint', async (context) => {
  const root = createRepository({
    prettierConfig: { semi: false },
    prettierEnabled: true,
    prettierPattern: '*.js',
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const original = 'const value=1\n';
  writeFileSync(path.join(root, 'sample.js'), original);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':sample.js'])), original);
  assert.equal(normalizeEol(readFileSync(path.join(root, 'sample.js'), 'utf8')), original);
});

test('runs the project Stylelint auto-fix and final verification', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
    stylelintConfig: {
      rules: {
        'color-hex-length': 'short',
      },
    },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'style.css'), '.sample { color: #ffffff; }\n');
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 0);
  assert.equal(
    normalizeEol(git(root, ['show', ':style.css'])),
    '.sample { color: #fff; }\n',
  );
});

test('enforces repo-owned selector complexity despite project overrides and disable comments', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
    styleComplexityEnabled: true,
    styleMaxCompoundSelectors: 2,
    styleMaxNestingDepth: 2,
    stylelintConfig: {
      rules: {
        'selector-max-compound-selectors': null,
      },
    },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = [
    '/* stylelint-disable selector-max-compound-selectors */',
    '.page .panel .action { color: red; }',
    '',
  ].join('\n');
  writeFileSync(path.join(root, 'style.css'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':style.css'])), content);
});

test('enforces repo-owned nesting depth', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
    styleComplexityEnabled: true,
    styleMaxCompoundSelectors: 4,
    styleMaxNestingDepth: 1,
    stylelintConfig: { rules: {} },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = '.page { .panel { .action { color: red; } } }\n';
  writeFileSync(path.join(root, 'style.css'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
});

test('auto-fixes only staged Stylelint content and restores unstaged edits', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
    stylelintConfig: {
      rules: {
        'color-hex-length': 'short',
      },
    },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'style.css'), '.sample { color: #000; }\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'test: baseline']);

  writeFileSync(path.join(root, 'style.css'), '.sample { color: #ffffff; }\n');
  git(root, ['add', 'style.css']);
  writeFileSync(
    path.join(root, 'style.css'),
    '.sample { color: #ffffff; }\n.local { color: #ffffff; }\n',
  );

  assert.equal(await runPreCommit(root), 0);
  assert.equal(
    normalizeEol(git(root, ['show', ':style.css'])),
    '.sample { color: #fff; }\n',
  );
  const worktree = normalizeEol(readFileSync(path.join(root, 'style.css'), 'utf8'));
  assert.match(worktree, /^\.sample \{ color: #fff; \}/);
  assert.match(worktree, /\.local \{ color: #ffffff; \}/);
  assert.doesNotMatch(git(root, ['show', ':style.css']), /\.local/);
});

test('rolls back Stylelint fixes when a later quality gate fails', async (context) => {
  const root = createRepository({
    prettierEnabled: false,
    stylelintEnabled: true,
    stylelintConfig: {
      rules: {
        'color-hex-length': 'short',
      },
    },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const css = '.sample { color: #ffffff; }\n';
  const javascript = 'const = ;\n';
  writeFileSync(path.join(root, 'style.css'), css);
  writeFileSync(path.join(root, 'sample.js'), javascript);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':style.css'])), css);
  assert.equal(normalizeEol(readFileSync(path.join(root, 'style.css'), 'utf8')), css);
});

test('blocks unfixable Stylelint problems without keeping partial fixes', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
    stylelintConfig: {
      rules: {
        'color-hex-length': 'short',
        'property-no-unknown': true,
      },
    },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const original = '.sample { widht: 1px; color: #ffffff; }\n';
  writeFileSync(path.join(root, 'style.css'), original);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':style.css'])), original);
  assert.equal(normalizeEol(readFileSync(path.join(root, 'style.css'), 'utf8')), original);
});

test('rejects Vue files that mix style languages', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
    stylelintConfig: {
      rules: {
        'property-no-unknown': true,
      },
    },
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = [
    '<template><div /></template>',
    '<style>.sample { color: red; }</style>',
    '<style lang="scss">.sample { color: blue; }</style>',
    '',
  ].join('\n');
  writeFileSync(path.join(root, 'App.vue'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':App.vue'])), content);
});

test('blocks staged Vue v-html even when optional quality gates are disabled', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = '<template><div v-html="payload" /></template>\n';
  writeFileSync(path.join(root, 'App.vue'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':App.vue'])), content);
});

test('blocks unsafe staged Vue target blank links when optional gates are disabled', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = '<template><a target="_blank">docs</a></template>\n';
  writeFileSync(path.join(root, 'Links.vue'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':Links.vue'])), content);
});

test('blocks staged dependency declarations when dependency governance is enabled', async (context) => {
  const root = createRepository({
    dependencyPolicyEnabled: true,
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const packageJson = `${JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    type: 'module',
    dependencies: { axios: '^1.7.0' },
  }, null, 2)}\n`;
  writeFileSync(path.join(root, 'package.json'), packageJson);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':package.json'])), packageJson);
});

test('blocks staged deletion of a required dependency lockfile', async (context) => {
  const root = createRepository({
    dependencyPolicyEnabled: true,
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  writeFileSync(
    path.join(root, 'package-lock.json'),
    `${JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': packageJson },
    }, null, 2)}\n`,
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'test: baseline']);
  rmSync(path.join(root, 'package-lock.json'));
  git(root, ['add', '-u']);

  assert.equal(await runPreCommit(root), 1);
});

test('blocks staged unlabeled Vue form controls when optional gates are disabled', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = '<template><input placeholder="Email"></template>\n';
  writeFileSync(path.join(root, 'Form.vue'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':Form.vue'])), content);
});

test('blocks staged Vue images without alt when optional gates are disabled', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const content = '<template><img src="status.png"></template>\n';
  writeFileSync(path.join(root, 'Status.vue'), content);
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
  assert.equal(normalizeEol(git(root, ['show', ':Status.vue'])), content);
});

test('allows deleting a Vue file when optional quality gates are disabled', async (context) => {
  const root = createRepository({
    enabled: false,
    filePlacementEnabled: false,
    prettierEnabled: false,
    stylelintEnabled: false,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'App.vue'), '<template><div /></template>\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'test: baseline']);
  rmSync(path.join(root, 'App.vue'));
  git(root, ['add', '-u']);

  assert.equal(await runPreCommit(root), 0);
});

test('requires a project Stylelint configuration when configured', async (context) => {
  const root = createRepository({
    enabled: false,
    prettierEnabled: false,
    stylelintEnabled: true,
  });
  context.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'style.css'), '.sample { color: red; }\n');
  git(root, ['add', '.']);

  assert.equal(await runPreCommit(root), 1);
});
