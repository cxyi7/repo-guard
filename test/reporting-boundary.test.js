import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { processOutputDiagnostics } from '../src/core/execution/process-output.js';
import {
  managedPolicies,
} from '../src/policies/managed-policies.js';
import {
  processFailureGuidanceIds,
} from '../src/core/result/process-failure-guidance.js';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const TEST_ROOT = path.join(process.cwd(), 'test');
const GENERATED_DIRECTORY_NAMES = new Set([
  '.tmp',
  '.vite',
  'coverage',
  'node_modules',
]);

function javascriptFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return GENERATED_DIRECTORY_NAMES.has(entry.name) ? [] : javascriptFiles(target);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  });
}

test('keeps gate implementations independent from console and report renderers', () => {
  for (const file of javascriptFiles(path.join(SOURCE_ROOT, 'gates'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bconsole\.|process\.exit(?:Code)?|renderConsole/,
      path.relative(SOURCE_ROOT, file));
    assert.doesNotMatch(source, /core\/report/,
      path.relative(SOURCE_ROOT, file));
  }
});

test('captures subprocess output instead of inheriting gate runner stdio', () => {
  const runners = javascriptFiles(SOURCE_ROOT).filter((file) => (
    file.endsWith('-runner.js') || file.endsWith(`${path.sep}quality-runner.js`)
  ));
  for (const file of runners) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /stdio\s*:\s*['"]inherit['"]/,
      path.relative(SOURCE_ROOT, file));
    assert.doesNotMatch(source, /console\.error/,
      path.relative(SOURCE_ROOT, file));
  }

  assert.deepEqual(processOutputDiagnostics({
    status: 1,
    stdout: Buffer.from('tool output\n'),
    stderr: 'tool failure\n',
  }), [
    {
      source: 'project-process', stream: 'stdout', level: 'info', message: 'tool output', redacted: false, truncated: false,
    },
    {
      source: 'project-process', stream: 'stderr', level: 'error', message: 'tool failure', redacted: false, truncated: false,
    },
  ]);

  const [safeDiagnostic] = processOutputDiagnostics({
    status: 1,
    stdout: `token=secret-value\n${'x'.repeat(70 * 1024)}`,
    stderr: '',
  }, { source: 'fixture' });
  assert.equal(safeDiagnostic.source, 'fixture');
  assert.equal(safeDiagnostic.redacted, true);
  assert.equal(safeDiagnostic.truncated, true);
  assert.doesNotMatch(safeDiagnostic.message, /secret-value/);
  assert.match(safeDiagnostic.message, /\[TRUNCATED after 65536 bytes\]/);
});

test('keeps direct console access inside the shared console renderer', () => {
  const consoleRenderer = path.join(SOURCE_ROOT, 'core', 'report', 'console-renderer.js');
  for (const file of javascriptFiles(SOURCE_ROOT)) {
    if (file === consoleRenderer) continue;
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bconsole\.(?:log|error|warn)|process\.(?:stdout|stderr)\.write/,
      path.relative(SOURCE_ROOT, file));
  }
});

test('does not retain gate-owned AI or console renderer compatibility helpers', () => {
  const sources = javascriptFiles(SOURCE_ROOT)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    sources,
    /build[A-Za-z]+Ai(?:Repair)?Instructions|renderConsole|formatArchitectureReport|formatCoverageReport|buildMaxFileLinesWarnings/,
  );
  assert.doesNotMatch(sources, /\b(?:problem|status)\.(?:reason|repair)\b|\bitem\.repair\b/);
  assert.doesNotMatch(sources, /error\s*:\s*new Error\s*\(/);
});

test('forbids untyped Error and AggregateError construction across project boundaries', () => {
  const typeErrorContractFiles = new Set([
    'exception-registry.js',
    'core/capability/execution-plan.js',
    'core/capability/gate-context.js',
    'core/capability/gate-definition.js',
    'core/capability/gate-registry.js',
    'core/error/repo-guard-error.js',
    'core/policy/managed-policy.js',
    'core/result/gate-result.js',
    'gates/security/dynamic-code-gate.js',
    'integrations/npm/external-script.js',
  ]);
  for (const root of [SOURCE_ROOT, TEST_ROOT]) {
    for (const file of javascriptFiles(root)) {
      const source = readFileSync(file, 'utf8');
      const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
      assert.doesNotMatch(
        source,
        /\bnew (?:Error|AggregateError)\s*\(/,
        relative,
      );
      assert.doesNotMatch(
        source,
        /\bthrow\s+(?:error|cause)\s*;/,
        relative,
      );
    }
  }

  for (const file of javascriptFiles(SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8');
    const relative = path.relative(SOURCE_ROOT, file).replaceAll('\\', '/');
    if (!typeErrorContractFiles.has(relative)) {
      assert.doesNotMatch(source, /\bnew TypeError\s*\(/, relative);
    }
  }
});

test('keeps consumer dependency resolution on typed configuration errors', () => {
  const source = readFileSync(path.join(SOURCE_ROOT, 'core', 'project', 'package.js'), 'utf8');
  assert.doesNotMatch(source, /throw new Error\s*\(/);
  assert.match(source, /project-package\/missing-manifest/);
  assert.match(source, /project-package\/dependency-not-installed/);
  assert.match(source, /project-package\/dependency-entry-unresolvable/);
});

test('keeps Git change protocol failures on typed execution errors', () => {
  const source = readFileSync(path.join(SOURCE_ROOT, 'git-changes.js'), 'utf8');
  assert.doesNotMatch(source, /throw new Error\s*\(/);
  assert.match(source, /git-changes\/incomplete-file-entry/);
  assert.match(source, /git-changes\/incomplete-rename-or-copy-entry/);
});

test('publishes the AI-ready GateResult v2 schema', () => {
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), 'gate-result.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.deepEqual(schema.properties.issues.items, { $ref: '#/$defs/issue' });
  assert.deepEqual(schema.$defs.diagnostic.required, [
    'source', 'stream', 'level', 'message', 'redacted', 'truncated',
  ]);
});

test('keeps managed AGENTS prompts and process repair guidance in central catalogs', () => {
  assert.deepEqual(managedPolicies.map(({ id }) => id), [
    'exception-policy',
    'architecture-policy',
    'unit-test-policy',
    'accessibility-test-policy',
  ]);
  assert.equal(new Set(managedPolicies.map(({ startMarker }) => startMarker)).size, 4);
  assert.deepEqual(processFailureGuidanceIds, [
    'quality.typecheck',
    'quality.build',
    'quality.unit-test',
    'quality.accessibility-test',
    'quality.lighthouse:build',
    'quality.lighthouse:collect',
    'quality.lighthouse:assert',
    'quality.unit-test:coverage-report',
  ]);

  const policyCatalog = path.join(SOURCE_ROOT, 'policies', 'managed-policies.js');
  for (const file of javascriptFiles(SOURCE_ROOT)) {
    if (file === policyCatalog) continue;
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /function managedLines|repo-guard:[a-z-]+-policy:start/,
      path.relative(SOURCE_ROOT, file));
  }
});
