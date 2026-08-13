import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { runExactNpmScript } from '../../integrations/npm/external-script.js';
import {
  assertReleaseScriptReadOnly,
  releaseEnvironment,
} from '../../integrations/npm/release-environment.js';
import { passedResult, violationResult } from '../native-result.js';
import { inspectPackageReadiness } from './package-readiness.js';

const RELEASE_SCRIPTS = Object.freeze({
  'release.check': 'check',
  'release.test': 'test',
});

function releaseCacheDirectory(root) {
  return path.join(root, 'node_modules', '.cache', 'repo-guard-release');
}

function projectManifest(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!existsSync(manifestPath)) throw new Error('package.json is required for release readiness');
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function inspectReleaseScript(root, script) {
  const scripts = projectManifest(root).scripts ?? {};
  if (typeof scripts[script] !== 'string' || scripts[script].trim() === '') {
    throw new Error(`Release readiness requires package.json script ${script}`);
  }
  assertReleaseScriptReadOnly(scripts, script);
  return { status: 'ready', summary: `Release readiness npm script (${script})` };
}

function scriptResult(gateId, script, execution, durationMs) {
  if (execution.status === 0) {
    return passedResult(gateId, `npm run ${script} passed`, { durationMs });
  }
  const diagnostics = [execution.stdout, execution.stderr]
    .filter((output) => output.trim())
    .map((message) => ({ level: 'error', message: message.trim() }));
  return violationResult(gateId, `npm run ${script} failed`, {
    durationMs,
    diagnostics,
    findings: [{
      ruleId: `release/${script}`,
      severity: 'error',
      message: `npm run ${script} exited with status ${execution.status}`,
      location: { path: 'package.json' },
      remediation: `Fix the ${script} script failure before release.`,
    }],
  });
}

function defineReleaseScriptGate(gateId, script, defaultTimeoutMs) {
  return defineGate({
    id: gateId,
    configVersions: [1],
    environments: ['release-ready'],
    mutation: 'read-only',
    defaultTimeoutMs,
    requiredScripts: [script],
    supportsCancellation: true,
    inspectSetup: ({ root }) => inspectReleaseScript(root, script),
    plan: () => ({ script }),
    run: async ({ root, plan, signal }) => {
      const started = Date.now();
      const execution = await runExactNpmScript({
        root,
        script: plan.script,
        signal,
        env: releaseEnvironment(process.env, releaseCacheDirectory(root)),
      });
      return scriptResult(gateId, plan.script, execution, Date.now() - started);
    },
  });
}

const checkGate = defineReleaseScriptGate('release.check', RELEASE_SCRIPTS['release.check'], 300000);
const testGate = defineReleaseScriptGate('release.test', RELEASE_SCRIPTS['release.test'], 900000);

const packageGate = defineGate({
  id: 'release.package',
  configVersions: [1],
  environments: ['release-ready'],
  mutation: 'read-only',
  defaultTimeoutMs: 300000,
  requires: ['release.check', 'release.test'],
  after: ['quality.build'],
  artifactTypes: ['npm-package-manifest'],
  supportsCancellation: true,
  inspectSetup: ({ root }) => {
    const manifest = projectManifest(root);
    const packScript = manifest.scripts?.['pack:check'];
    if (packScript !== 'npm pack --dry-run --json --ignore-scripts') {
      throw new Error(
        'Release readiness requires package.json script pack:check '
        + 'to equal "npm pack --dry-run --json --ignore-scripts"',
      );
    }
    return { status: 'ready', summary: 'npm package release metadata' };
  },
  plan: () => Object.freeze({ dryRun: true, ignoreScripts: true }),
  run: async ({ root, signal }) => {
    const started = Date.now();
    const result = await inspectPackageReadiness({
      root,
      signal,
      cacheDirectory: releaseCacheDirectory(root),
    });
    const durationMs = Date.now() - started;
    if (result.execution.status !== 0) {
      return createGateResult({
        gateId: 'release.package',
        status: 'execution-error',
        summary: 'npm pack --dry-run failed',
        durationMs,
        error: new Error(result.execution.stderr.trim() || 'npm pack --dry-run failed'),
      });
    }
    const metrics = {
      packedFiles: result.packageEntry.files.length,
      packedBytes: result.packageEntry.size,
      unpackedBytes: result.packageEntry.unpackedSize,
      schemas: result.schemaCount,
      violations: result.findings.length,
    };
    return result.findings.length === 0
      ? passedResult('release.package', `Package ${result.packageEntry.name}@${result.packageEntry.version} is release-ready`, { metrics, durationMs })
      : violationResult('release.package', `Package release metadata has ${result.findings.length} violation(s)`, { findings: result.findings, metrics, durationMs });
  },
});

export const releaseReadinessGates = Object.freeze([checkGate, testGate, packageGate]);
