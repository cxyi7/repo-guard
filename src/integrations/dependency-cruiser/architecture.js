import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';

function resolveDependencyCruiser(root) {
  const metadata = resolveProjectPackageMetadata(
    root,
    'dependency-cruiser',
    'Architecture dependency gate',
    { requireEntry: false },
  );
  const packageJson = JSON.parse(readFileSync(metadata.packagePath, 'utf8'));
  const bin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.['dependency-cruiser']
      ?? packageJson.bin?.['dependency-cruise']
      ?? packageJson.bin?.depcruise;
  if (typeof bin !== 'string' || !bin.trim()) {
    throw configurationError(
      'architecture/missing-cli-binary',
      'Installed dependency-cruiser does not expose a supported CLI binary',
    );
  }
  const cliPath = path.resolve(path.dirname(metadata.packagePath), bin);
  if (!existsSync(cliPath)) {
    throw configurationError(
      'architecture/cli-file-missing',
      'dependency-cruiser CLI file was not found in the installed package',
    );
  }
  return { ...metadata, cliPath };
}

function resolveTypeScriptConfig(root, configuredPath) {
  if (configuredPath) return configuredPath;
  return existsSync(path.join(root, 'tsconfig.json')) ? 'tsconfig.json' : null;
}

export function validateArchitectureSetup(root, config) {
  const dependencyCruiser = resolveDependencyCruiser(root);
  const optionLikeSource = config.sourcePaths.find((sourcePath) => sourcePath.startsWith('-'));
  if (optionLikeSource) {
    throw configurationError(
      'architecture/option-like-source',
      `Architecture source path cannot start with "-": ${optionLikeSource}`,
    );
  }
  const missingSources = config.sourcePaths.filter((sourcePath) => (
    !/[?*{}[\]]/.test(sourcePath) && !existsSync(path.join(root, sourcePath))
  ));
  if (missingSources.length > 0) {
    throw configurationError(
      'architecture/missing-source-path',
      `Architecture source path does not exist: ${missingSources.join(', ')}`,
    );
  }
  const tsConfig = resolveTypeScriptConfig(root, config.tsConfig);
  if (tsConfig && !existsSync(path.join(root, tsConfig))) {
    throw configurationError(
      'architecture/missing-tsconfig',
      `Architecture tsConfig does not exist: ${tsConfig}`,
    );
  }
  return { dependencyCruiser, tsConfig };
}

export function createDependencyCruiserConfig(config, { tsConfig = null } = {}) {
  return {
    forbidden: config.rules.map((rule) => ({ ...rule })),
    options: {
      doNotFollow: { path: 'node_modules' },
      ...(config.exclude === null ? {} : { exclude: { path: config.exclude } }),
      ...(tsConfig ? { tsConfig: { fileName: tsConfig } } : {}),
    },
  };
}

export function parseArchitectureReport(output) {
  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw executionError(
      'architecture/invalid-json-report',
      `dependency-cruiser returned invalid JSON: ${error.message}`,
      { cause: error },
    );
  }
  const violations = report?.summary?.violations;
  if (!Array.isArray(violations)) {
    throw executionError(
      'architecture/invalid-report-shape',
      'dependency-cruiser JSON report is missing summary.violations',
    );
  }
  return {
    modulesCruised: Number.isInteger(report.summary.totalCruised)
      ? report.summary.totalCruised
      : Array.isArray(report.modules) ? report.modules.length : 0,
    violations,
  };
}

export function executeArchitectureAnalysis({ root, config }) {
  const setup = validateArchitectureSetup(root, config);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-architecture-'));
  const temporaryConfig = path.join(temporaryRoot, 'dependency-cruiser.config.json');
  try {
    writeFileSync(
      temporaryConfig,
      `${JSON.stringify(createDependencyCruiserConfig(config, setup), null, 2)}\n`,
      'utf8',
    );
    const execution = spawnSync(
      process.execPath,
      [
        setup.dependencyCruiser.cliPath,
        '--output-type',
        'json',
        '--config',
        temporaryConfig,
        '--',
        ...config.sourcePaths,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: config.timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return Object.freeze({ setup, execution });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
