import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isRepoGuardError } from '../../src/core/error/repo-guard-error.js';
import { createGateResult } from '../../src/core/result/gate-result.js';
import { resolveProjectPackageMetadata } from '../../src/core/project/package.js';

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail('Expected callback to throw');
}

test('reports a typed configuration issue when package.json is missing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  const error = captureError(() => resolveProjectPackageMetadata(root, 'vitest', 'Vitest'));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'configuration');
  assert.equal(error.code, 'project-package/missing-manifest');
  assert.equal(error.details.location.path, 'package.json');
  assert.ok(error.remediation.steps.length > 0);
});

test('reports a typed configuration issue when a project dependency is missing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const error = captureError(() => resolveProjectPackageMetadata(root, 'vitest', 'Vitest'));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'configuration');
  assert.equal(error.code, 'project-package/dependency-not-installed');
  assert.deepEqual(error.details.evidence, [{
    type: 'dependency-resolution',
    message: '请求的包： vitest；集成： Vitest',
    location: { path: 'package.json' },
  }]);
  assert.match(error.expected, /devDependency/);

  const result = createGateResult({
    gateId: 'quality.unit-test',
    status: 'configuration-error',
    summary: error.message,
    error,
  });
  assert.equal(result.issues[0].code, 'project-package/dependency-not-installed');
  assert.equal(result.issues[0].evidence[0].type, 'dependency-resolution');
  assert.ok(result.issues[0].remediation.steps.length > 0);
});

test('distinguishes an installed package with an unresolvable runtime entry', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const packageRoot = path.join(root, 'node_modules', 'broken-tool');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"broken-tool","version":"1.2.3"}\n');

  const error = captureError(() => (
    resolveProjectPackageMetadata(root, 'broken-tool', 'Broken tool')
  ));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.kind, 'configuration');
  assert.equal(error.code, 'project-package/dependency-entry-unresolvable');
  assert.ok(error.cause instanceof Error);
});

function createWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-project-package-'));
  const applicationRoot = path.join(root, 'apps', 'web');
  mkdirSync(applicationRoot, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"name":"workspace"}\n');
  writeFileSync(path.join(applicationRoot, 'package.json'), '{"name":"application"}\n');
  return { root, applicationRoot };
}

function installPackage(root, packageName, manifest = {}) {
  const packageRoot = path.join(root, 'node_modules', packageName);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.2.3',
    exports: './index.js',
    ...manifest,
  }));
  writeFileSync(path.join(packageRoot, 'index.js'), 'module.exports = {};\n');
  return packageRoot;
}

test('resolves hoisted packages with private manifests, including scoped packages', () => {
  for (const packageName of ['private-tool', '@fixture/private-tool']) {
    const { root, applicationRoot } = createWorkspace();
    const packageRoot = installPackage(root, packageName);
    const metadata = resolveProjectPackageMetadata(applicationRoot, packageName, '测试工具');

    assert.equal(metadata.packagePath, realpathSync(path.join(packageRoot, 'package.json')));
    assert.equal(metadata.entryPath, realpathSync(path.join(packageRoot, 'index.js')));
    assert.equal(metadata.version, '1.2.3');
  }
});

test('uses the nearest installation for both private metadata and the runtime entry', () => {
  const { root, applicationRoot } = createWorkspace();
  installPackage(root, 'private-tool', { version: '9.0.0' });
  const nearestRoot = installPackage(path.join(root, 'apps'), 'private-tool');

  const metadata = resolveProjectPackageMetadata(applicationRoot, 'private-tool', '测试工具');

  assert.equal(metadata.packagePath, realpathSync(path.join(nearestRoot, 'package.json')));
  assert.equal(metadata.entryPath, realpathSync(path.join(nearestRoot, 'index.js')));
  assert.equal(metadata.version, '1.2.3');
});

test('follows consumer dependency junctions without falling back to another installation', () => {
  const { root, applicationRoot } = createWorkspace();
  const packageRoot = installPackage(path.join(root, 'store'), '@fixture/linked-tool');
  const linkedRoot = path.join(root, 'node_modules', '@fixture', 'linked-tool');
  mkdirSync(path.dirname(linkedRoot), { recursive: true });
  symlinkSync(packageRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');

  const metadata = resolveProjectPackageMetadata(applicationRoot, '@fixture/linked-tool', '测试工具');

  assert.equal(metadata.packagePath, realpathSync(path.join(packageRoot, 'package.json')));
  assert.equal(metadata.entryPath, realpathSync(path.join(packageRoot, 'index.js')));
});

test('preserves symlink runtime entries while verifying their physical package installation', () => {
  const { root, applicationRoot } = createWorkspace();
  const packageRoot = installPackage(path.join(root, 'store'), '@fixture/linked-tool');
  const linkedRoot = path.join(root, 'node_modules', '@fixture', 'linked-tool');
  mkdirSync(path.dirname(linkedRoot), { recursive: true });
  symlinkSync(packageRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const source = [
    `import { resolveProjectPackageMetadata } from ${JSON.stringify(new URL('../../src/core/project/package.js', import.meta.url).href)};`,
    `const metadata = resolveProjectPackageMetadata(${JSON.stringify(applicationRoot)}, '@fixture/linked-tool', '测试工具');`,
    'process.stdout.write(JSON.stringify(metadata));',
  ].join('\n');

  const output = execFileSync(process.execPath, [
    '--preserve-symlinks', '--input-type=module', '--eval', source,
  ], { cwd: applicationRoot, encoding: 'utf8' });
  const metadata = JSON.parse(output);

  assert.equal(metadata.packagePath, realpathSync(path.join(packageRoot, 'package.json')));
  assert.equal(metadata.entryPath, path.join(linkedRoot, 'index.js'));
});

test('allows a hoisted CLI-only package without requiring its library entry', () => {
  const { root, applicationRoot } = createWorkspace();
  const packageRoot = installPackage(root, 'cli-only-tool', {
    exports: {},
    bin: './cli.js',
  });

  const metadata = resolveProjectPackageMetadata(applicationRoot, 'cli-only-tool', '测试工具', {
    requireEntry: false,
  });

  assert.equal(metadata.packagePath, realpathSync(path.join(packageRoot, 'package.json')));
  assert.equal(metadata.entryPath, null);
  assert.equal(metadata.version, '1.2.3');
});

test('reports a broken nearest entry even when an ancestor installation is valid', () => {
  const { root, applicationRoot } = createWorkspace();
  installPackage(root, 'private-tool');
  installPackage(path.join(root, 'apps'), 'private-tool', { exports: './missing.js' });

  const error = captureError(() => (
    resolveProjectPackageMetadata(applicationRoot, 'private-tool', '测试工具')
  ));

  assert.equal(error.code, 'project-package/dependency-entry-unresolvable');
  assert.equal(error.kind, 'configuration');
});

test('does not combine a nearest manifest with an ancestor fallback entry', () => {
  const { root, applicationRoot } = createWorkspace();
  installPackage(root, 'private-tool');
  const nearestRoot = installPackage(path.join(root, 'apps'), 'private-tool', { exports: undefined });
  rmSync(path.join(nearestRoot, 'index.js'));

  const error = captureError(() => (
    resolveProjectPackageMetadata(applicationRoot, 'private-tool', '测试工具')
  ));

  assert.equal(error.code, 'project-package/dependency-entry-unresolvable');
});

test('reports invalid dependency manifests as typed Chinese configuration errors', () => {
  for (const manifest of ['{invalid', 'null', '[]', '"text"']) {
    const { root, applicationRoot } = createWorkspace();
    installPackage(root, 'private-tool');
    const nearestRoot = installPackage(path.join(root, 'apps'), 'private-tool');
    writeFileSync(path.join(nearestRoot, 'package.json'), manifest);

    const error = captureError(() => (
      resolveProjectPackageMetadata(applicationRoot, 'private-tool', '测试工具', {
        requireEntry: false,
      })
    ));

    assert.equal(isRepoGuardError(error), true);
    assert.equal(error.code, 'project-package/dependency-manifest-invalid');
    assert.equal(error.kind, 'configuration');
    assert.match(error.message, /包清单/);
    assert.equal(error.details.location.path, '../node_modules/private-tool/package.json');
  }
});

test('reports dependency manifest read failures without masking them as missing packages', () => {
  const { root, applicationRoot } = createWorkspace();
  const manifestPath = path.join(root, 'node_modules', 'private-tool', 'package.json');
  mkdirSync(manifestPath, { recursive: true });

  const error = captureError(() => (
    resolveProjectPackageMetadata(applicationRoot, 'private-tool', '测试工具', {
      requireEntry: false,
    })
  ));

  assert.equal(isRepoGuardError(error), true);
  assert.equal(error.code, 'project-package/dependency-manifest-unreadable');
  assert.equal(error.kind, 'configuration');
  assert.match(error.message, /读取.*包清单/);
});

test('does not use repo-guard dependencies when the consumer has no installation', () => {
  const { applicationRoot } = createWorkspace();
  const error = captureError(() => (
    resolveProjectPackageMetadata(applicationRoot, 'eslint', 'ESLint 工具')
  ));

  assert.equal(error.code, 'project-package/dependency-not-installed');
});

test('does not discover tools from global NODE_PATH outside consumer ancestor installations', () => {
  const { root, applicationRoot } = createWorkspace();
  installPackage(path.join(root, 'global'), 'global-tool', {
    exports: { '.': './index.js', './package.json': './package.json' },
  });
  const source = [
    `import { resolveProjectPackageMetadata } from ${JSON.stringify(new URL('../../src/core/project/package.js', import.meta.url).href)};`,
    'try {',
    `  resolveProjectPackageMetadata(${JSON.stringify(applicationRoot)}, 'global-tool', '测试工具');`,
    "  process.stdout.write('unexpected-success');",
    '} catch (error) { process.stdout.write(error.code); }',
  ].join('\n');

  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: applicationRoot,
    env: { ...process.env, NODE_PATH: path.join(root, 'global', 'node_modules') },
    encoding: 'utf8',
  });

  assert.equal(output, 'project-package/dependency-not-installed');
});

test('supports ESM default entries and explicitly rejects import-only runtime conditions', () => {
  const { root, applicationRoot } = createWorkspace();
  const packageRoot = installPackage(root, 'esm-tool', { type: 'module' });
  writeFileSync(path.join(packageRoot, 'index.js'), 'export default {};\n');
  const metadata = resolveProjectPackageMetadata(applicationRoot, 'esm-tool', '测试工具');
  assert.equal(metadata.entryPath, realpathSync(path.join(packageRoot, 'index.js')));

  installPackage(root, 'import-only-tool', {
    type: 'module',
    exports: { '.': { import: './index.js' } },
  });
  const error = captureError(() => (
    resolveProjectPackageMetadata(applicationRoot, 'import-only-tool', '测试工具')
  ));
  assert.equal(error.code, 'project-package/dependency-entry-unresolvable');
  assert.equal(error.cause.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
});
