import { existsSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { configurationError } from '../../core/error/repo-guard-error.js';

const RUNNER_PATH = fileURLToPath(import.meta.url);

export async function runMutationTestChild(argumentsList = process.argv.slice(2)) {
  const [entryPath, configFile, jsonReport, htmlReport, originalHtml, serializedDefaults] = argumentsList;
  const module = await import(pathToFileURL(entryPath).href);
  if (typeof module.Stryker !== 'function') {
    throw configurationError(
      'mutation-test/missing-public-api',
      '@stryker-mutator/core 未导出公开的 Stryker 类',
    );
  }
  const reporters = originalHtml === 'true'
    ? ['clear-text', 'progress', 'json', 'html']
    : ['clear-text', 'progress', 'json'];
  const defaults = serializedDefaults ? JSON.parse(serializedDefaults) : null;
  let native = {};
  if (defaults && existsSync(configFile)) {
    native = path.extname(configFile).toLowerCase() === '.json' ? JSON.parse(readFileSync(configFile, 'utf8'))
      : (await import(pathToFileURL(path.resolve(configFile)).href)).default;
    if (!native || typeof native !== 'object' || Array.isArray(native)) {
      throw configurationError('mutation-test/invalid-native-config', 'Stryker 原生配置必须导出对象');
    }
  }
  // 使用明确的空配置，阻止 Stryker 再次自动发现配置并改变合并顺序。
  const temporaryDirectory = defaults ? mkdtempSync(path.join(tmpdir(), 'repo-guard-stryker-')) : null;
  const effectiveConfig = temporaryDirectory ? path.join(temporaryDirectory, 'config.json') : configFile;
  if (temporaryDirectory) writeFileSync(effectiveConfig, '{}');
  const options = {
    ...(defaults ? { ...defaults, ...native,
      thresholds: { ...defaults.thresholds, ...native.thresholds },
      vitest: { ...defaults.vitest, ...native.vitest } } : {}),
    configFile: effectiveConfig,
    inPlace: false,
    reporters,
    jsonReporter: { fileName: jsonReport },
    ...(originalHtml === 'true' ? { htmlReporter: { fileName: htmlReport } } : {}),
  };
  try {
    await new module.Stryker(options).runMutationTest();
  } finally {
    if (temporaryDirectory) { unlinkSync(effectiveConfig); rmdirSync(temporaryDirectory); }
  }
}

if (path.resolve(process.argv[1] ?? '') === RUNNER_PATH) {
  await runMutationTestChild();
}
