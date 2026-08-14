import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { runExactNpmCommand } from '../../integrations/npm/external-script.js';
import { releaseEnvironment } from '../../integrations/npm/release-environment.js';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SENSITIVE_PACKAGE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|credentials?(?:\.|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|[^/]*(?:private[-_.]?key|secrets?|(?:access|auth|npm|refresh)[-_.]?token)[^/]*)/i;

function readJson(root, relativePath) {
  const target = path.join(root, relativePath);
  if (!existsSync(target)) throw configurationError('release-readiness/missing-json-file', `${relativePath} is required for release readiness`, {
    details: { location: { path: relativePath } },
  });
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw configurationError('release-readiness/invalid-json-file', `${relativePath} must contain valid JSON: ${error.message}`, {
      cause: error,
      details: { location: { path: relativePath } },
    });
  }
}

function collectExportTargets(value, targets = []) {
  if (typeof value === 'string') targets.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectExportTargets(entry, targets));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectExportTargets(entry, targets));
  }
  return targets;
}

function normalizedTarget(value) {
  return value.replace(/^\.\//, '').replaceAll('\\', '/');
}

function finding(ruleId, message, location, remediation) {
  return { ruleId, severity: 'error', message, location, remediation };
}

function inspectMetadata(root, manifest, packedFiles) {
  const findings = [];
  const add = (ruleId, message, relativePath, remediation) => findings.push(finding(
    ruleId,
    message,
    { path: relativePath },
    remediation,
  ));

  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    add('release/package-name', 'package.json must declare a package name', 'package.json', 'Set package.json name to the package that will be released.');
  }
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
    add('release/version', 'package.json version must be an exact SemVer value', 'package.json', 'Set an exact SemVer version without a range or tag.');
  }
  if (manifest.private === true) {
    add('release/private-package', 'package.json marks the package as private', 'package.json', 'Review the release intent and set private to false before using release-ready.');
  }

  const lock = readJson(root, 'package-lock.json');
  const lockRoot = lock.packages?.[''];
  if (lock.name !== manifest.name || lock.version !== manifest.version
    || lockRoot?.name !== manifest.name || lockRoot?.version !== manifest.version) {
    add('release/lockfile-version', 'package-lock.json root name and version must match package.json', 'package-lock.json', 'Regenerate package-lock.json from the current package metadata.');
  }

  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    add('release/changelog', 'CHANGELOG.md is required', 'CHANGELOG.md', 'Add a release entry for the package version.');
  } else if (SEMVER.test(manifest.version ?? '')) {
    const escaped = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^## ${escaped}(?:\\s|$)`, 'm').test(readFileSync(changelogPath, 'utf8'))) {
      add('release/changelog', `CHANGELOG.md has no heading for ${manifest.version}`, 'CHANGELOG.md', `Add a "## ${manifest.version}" release entry.`);
    }
  }

  const schemaPaths = new Set([
    ...collectExportTargets(manifest.exports).map(normalizedTarget),
    ...(Array.isArray(manifest.files) ? manifest.files.map(normalizedTarget) : []),
  ].filter((target) => target.endsWith('.schema.json')));
  for (const schemaPath of schemaPaths) {
    let schema;
    try {
      schema = readJson(root, schemaPath);
    } catch (error) {
      add('release/schema', error.message, schemaPath, 'Create valid JSON Schema at the declared package path.');
      continue;
    }
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      add('release/schema-version', `${schemaPath} must declare JSON Schema draft 2020-12`, schemaPath, 'Set $schema to https://json-schema.org/draft/2020-12/schema.');
    }
  }

  const requiredTargets = new Set([
    ...collectExportTargets(manifest.exports).map(normalizedTarget),
    ...(typeof manifest.bin === 'string'
      ? [normalizedTarget(manifest.bin)]
      : Object.values(manifest.bin ?? {}).map(normalizedTarget)),
    ...schemaPaths,
    'package.json',
    'CHANGELOG.md',
    'README.md',
  ]);
  for (const target of requiredTargets) {
    const included = target.includes('*')
      ? micromatch.some([...packedFiles], target, { dot: true })
      : packedFiles.has(target);
    if (!included) {
      add('release/artifact-missing', `${target} is declared or required but absent from npm pack output`, 'package.json', 'Update package files/exports or generate the missing artifact before release.');
    }
  }
  for (const packedPath of packedFiles) {
    if (SENSITIVE_PACKAGE_PATH.test(packedPath)) {
      add('release/sensitive-artifact', `npm pack would include sensitive path ${packedPath}`, packedPath, 'Remove the sensitive file from the published package.');
    }
  }
  return { findings, schemaCount: schemaPaths.size };
}

export async function inspectPackageReadiness({ root, signal, cacheDirectory = null }) {
  const manifest = readJson(root, 'package.json');
  const execution = await runExactNpmCommand({
    root,
    argumentsList: ['pack', '--dry-run', '--json', '--ignore-scripts'],
    signal,
    env: releaseEnvironment(process.env, cacheDirectory),
  });
  if (execution.status !== 0) {
    return {
      execution,
      findings: [],
      packageEntry: null,
      schemaCount: 0,
    };
  }
  let packReport;
  try {
    packReport = JSON.parse(execution.stdout);
  } catch (error) {
    throw executionError('release-readiness/invalid-pack-json', `npm pack --dry-run returned invalid JSON: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(packReport) || packReport.length !== 1 || !Array.isArray(packReport[0]?.files)) {
    throw executionError('release-readiness/invalid-pack-manifest', 'npm pack --dry-run must return exactly one package with a file manifest');
  }
  const packageEntry = packReport[0];
  const packedFiles = new Set(packageEntry.files.map(({ path: file }) => normalizedTarget(file)));
  const inspected = inspectMetadata(root, manifest, packedFiles);
  if (packageEntry.name !== manifest.name || packageEntry.version !== manifest.version) {
    inspected.findings.push(finding(
      'release/packed-identity',
      'npm pack name and version must match package.json',
      { path: 'package.json' },
      'Reconcile package metadata before release.',
    ));
  }
  return { execution, packageEntry, ...inspected };
}
