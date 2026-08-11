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
import { resolveProjectPackageMetadata } from './project-package.js';

function resolveDependencyCruiser(root) {
  const metadata = resolveProjectPackageMetadata(
    root,
    'dependency-cruiser',
    'Architecture dependency gate',
  );
  const packageJson = JSON.parse(readFileSync(metadata.packagePath, 'utf8'));
  const bin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.['dependency-cruiser']
      ?? packageJson.bin?.['dependency-cruise']
      ?? packageJson.bin?.depcruise;
  if (typeof bin !== 'string' || !bin.trim()) {
    throw new Error('Installed dependency-cruiser does not expose a supported CLI binary');
  }
  const cliPath = path.resolve(path.dirname(metadata.packagePath), bin);
  if (!existsSync(cliPath)) {
    throw new Error(`dependency-cruiser CLI was not found: ${cliPath}`);
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
    throw new Error(`Architecture source path cannot start with "-": ${optionLikeSource}`);
  }
  const missingSources = config.sourcePaths.filter((sourcePath) => (
    !/[?*{}[\]]/.test(sourcePath) && !existsSync(path.join(root, sourcePath))
  ));
  if (missingSources.length > 0) {
    throw new Error(
      `Architecture source path does not exist: ${missingSources.join(', ')}`,
    );
  }
  const tsConfig = resolveTypeScriptConfig(root, config.tsConfig);
  if (tsConfig && !existsSync(path.join(root, tsConfig))) {
    throw new Error(`Architecture tsConfig does not exist: ${tsConfig}`);
  }
  return { dependencyCruiser, tsConfig };
}

export function detectProjectArchitectureSetup(root, config) {
  try {
    return { ready: true, setup: validateArchitectureSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
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
    throw new Error(`dependency-cruiser returned invalid JSON: ${error.message}`);
  }
  const violations = report?.summary?.violations;
  if (!Array.isArray(violations)) {
    throw new Error('dependency-cruiser JSON report is missing summary.violations');
  }
  return {
    modulesCruised: Number.isInteger(report.summary.totalCruised)
      ? report.summary.totalCruised
      : Array.isArray(report.modules) ? report.modules.length : 0,
    violations,
  };
}

function violationSeverity(violation) {
  return violation?.rule?.severity ?? violation?.severity ?? 'warn';
}

function formatViolation(violation, index) {
  const severity = violationSeverity(violation);
  const ruleName = violation?.rule?.name ?? violation?.ruleName ?? 'unnamed';
  const from = violation?.from ?? violation?.module ?? '(unknown source)';
  const to = violation?.to ? ` -> ${violation.to}` : '';
  const cycle = Array.isArray(violation?.cycle) && violation.cycle.length > 0
    ? `\n     cycle: ${violation.cycle.join(' -> ')}`
    : '';
  return `  ${index + 1}. [${severity}] ${ruleName}: ${from}${to}${cycle}`;
}

export function formatArchitectureReport(result, version = 'unknown') {
  const errors = result.violations.filter((violation) => (
    violationSeverity(violation) === 'error'
  )).length;
  const warnings = result.violations.filter((violation) => (
    violationSeverity(violation) === 'warn'
  )).length;
  return [
    `repo-guard architecture report: dependency-cruiser ${version}, `
      + `${result.modulesCruised} modules, ${result.violations.length} violations `
      + `(${errors} errors, ${warnings} warnings).`,
    ...result.violations.map(formatViolation),
  ].join('\n');
}

export function runArchitectureGate({ root, config }) {
  const setup = validateArchitectureSetup(root, config);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-architecture-'));
  const temporaryConfig = path.join(temporaryRoot, 'dependency-cruiser.config.json');
  try {
    writeFileSync(
      temporaryConfig,
      `${JSON.stringify(createDependencyCruiserConfig(config, setup), null, 2)}\n`,
      'utf8',
    );
    console.log(
      `repo-guard architecture: cruising ${config.sourcePaths.join(', ')} `
      + `with dependency-cruiser ${setup.dependencyCruiser.version}...`,
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
    if (execution.error) {
      if (execution.error.code === 'ETIMEDOUT') {
        console.error(`Architecture dependency analysis exceeded ${config.timeoutMs}ms.`);
        return 1;
      }
      throw new Error(`Unable to run dependency-cruiser: ${execution.error.message}`);
    }
    if (execution.status !== 0) {
      const details = execution.stderr?.trim() || execution.stdout?.trim();
      throw new Error(
        `dependency-cruiser failed with exit code ${execution.status}`
        + `${details ? `:\n${details}` : ''}`,
      );
    }
    const report = parseArchitectureReport(execution.stdout);
    const formatted = formatArchitectureReport(report, setup.dependencyCruiser.version);
    const hasErrors = report.violations.some((violation) => (
      violationSeverity(violation) === 'error'
    ));
    if (hasErrors) {
      console.error([
        formatted,
        'Architecture dependency gate failed. Fix dependency direction, extract a lower-level module, or correct the import path.',
        'Do not disable, ignore, or weaken an architecture rule to make the push pass.',
      ].join('\n'));
      return 1;
    }
    console.log(formatted);
    console.log('repo-guard architecture passed.');
    return 0;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
