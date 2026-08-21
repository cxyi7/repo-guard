import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { configurationError } from '../../core/error/repo-guard-error.js';

const RUNNER_PATH = fileURLToPath(import.meta.url);

export async function runMutationTestChild(argumentsList = process.argv.slice(2)) {
  const [entryPath, configFile, jsonReport, htmlReport, originalHtml] = argumentsList;
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
  const options = {
    configFile,
    inPlace: false,
    reporters,
    jsonReporter: { fileName: jsonReport },
    ...(originalHtml === 'true' ? { htmlReporter: { fileName: htmlReport } } : {}),
  };
  await new module.Stryker(options).runMutationTest();
}

if (path.resolve(process.argv[1] ?? '') === RUNNER_PATH) {
  await runMutationTestChild();
}
