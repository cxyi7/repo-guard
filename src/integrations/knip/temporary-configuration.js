import { toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 临时配置只用于本次子进程；不覆盖用户文件。 */
export function prepareKnipConfiguration(root, config, setup) {
  if (config.options === undefined)
    return { file: setup.configFile, cleanup() {} };
  const directory = mkdtempSync(path.join(tmpdir(), 'repo-guard-knip-'));
  try {
    const emptyFile = path.join(directory, 'empty.json');
    const file = path.join(directory, 'merged.mjs');
    const specification = {
      root,
      packagePath: setup.packagePath,
      options: config.options,
      configFile: setup.configFile,
      emptyFile,
    };
    writeFileSync(emptyFile, '{}');
    writeFileSync(
      file,
      `import { loadMergedKnipOptions } from ${JSON.stringify(new URL('./configuration.js', import.meta.url).href)};\nexport default (args) => loadMergedKnipOptions(${JSON.stringify(specification)}, args);\n`,
    );
    return {
      file,
      cleanup() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (cause) {
    rmSync(directory, { recursive: true, force: true });
    throw toRepoGuardError(cause, {
      code: 'dead-code/temporary-configuration',
    });
  }
}
