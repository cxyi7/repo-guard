import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';

export const LIGHTHOUSE_CONFIG_FILES = Object.freeze([
  '.lighthouserc.js',
  'lighthouserc.js',
  '.lighthouserc.cjs',
  'lighthouserc.cjs',
  '.lighthouserc.json',
  'lighthouserc.json',
  '.lighthouserc.yml',
  'lighthouserc.yml',
  '.lighthouserc.yaml',
  'lighthouserc.yaml',
]);

export function readProjectPackage(root) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) {
    throw configurationError('lighthouse/invalid-setup', `package.json was not found in repository root: ${root}`);
  }
  try {
    return JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw configurationError('lighthouse/invalid-setup', `Unable to read package.json: ${error.message}`);
  }
}

export function detectVueProject(root) {
  const packageJson = readProjectPackage(root);
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
  };
  return {
    isVue: Object.hasOwn(dependencies, 'vue'),
    packageJson,
  };
}

export function findProjectLighthouseConfig(root, configuredFile = null) {
  if (configuredFile) {
    if (path.isAbsolute(configuredFile)) {
      throw configurationError('lighthouse/invalid-setup', 'lighthouse.configFile must be relative to the repository root');
    }
    const resolved = path.resolve(root, configuredFile);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw configurationError('lighthouse/invalid-setup', 'lighthouse.configFile must stay inside the repository root');
    }
    return existsSync(resolved) ? relative.replace(/\\/g, '/') : null;
  }

  return LIGHTHOUSE_CONFIG_FILES.find((file) => existsSync(path.join(root, file))) || null;
}

export function resolveProjectLighthouseMetadata(root) {
  const requireFromProject = createRequire(path.join(root, 'package.json'));
  let packagePath;
  try {
    packagePath = requireFromProject.resolve('@lhci/cli/package.json');
  } catch {
    throw configurationError('lighthouse/invalid-setup',
      'Lighthouse CI is enabled but is not installed by this project. '
      + 'Install @lhci/cli as a project devDependency.',
    );
  }
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const binEntry = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.lhci;
  if (typeof binEntry !== 'string') {
    throw configurationError('lighthouse/invalid-setup',
      `Unsupported Lighthouse CI ${packageJson.version || 'unknown'}: the lhci executable is missing`,
    );
  }
  const binPath = path.resolve(path.dirname(packagePath), binEntry);
  if (!existsSync(binPath)) {
    throw configurationError('lighthouse/invalid-setup', `Unsupported Lighthouse CI ${packageJson.version}: ${binEntry} was not found`);
  }
  return {
    binPath,
    packagePath,
    version: packageJson.version || 'unknown',
  };
}

export function validateVueLighthouseSetup(root, config) {
  const { isVue, packageJson } = detectVueProject(root);
  if (!isVue) {
    throw configurationError('lighthouse/invalid-setup', 'Lighthouse support currently requires a Vue project with vue in package.json');
  }

  const lighthouse = resolveProjectLighthouseMetadata(root);
  const configFile = findProjectLighthouseConfig(root, config.configFile);
  if (!configFile) {
    const expected = config.configFile || 'lighthouserc.*';
    throw configurationError('lighthouse/invalid-setup', `Lighthouse configuration was not found: ${expected}`);
  }
  if (config.buildScript && !packageJson.scripts?.[config.buildScript]) {
    throw configurationError('lighthouse/invalid-setup', `Lighthouse build script was not found: package.json#scripts.${config.buildScript}`);
  }

  return {
    configFile,
    lighthouse,
    packageJson,
  };
}
