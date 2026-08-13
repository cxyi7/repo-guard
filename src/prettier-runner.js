import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { resolveProjectPackageMetadata } from './project-package.js';
import { normalizeStagedFiles } from './staged-files.js';

export function resolveProjectPrettierMetadata(root) {
  return resolveProjectPackageMetadata(root, 'prettier', 'Prettier');
}

async function loadProjectPrettier(root) {
  const metadata = resolveProjectPrettierMetadata(root);
  const prettierModule = await import(pathToFileURL(metadata.entryPath).href);
  const prettier = typeof prettierModule.format === 'function'
    ? prettierModule
    : prettierModule.default;

  if (!prettier || typeof prettier.format !== 'function') {
    throw new Error(
      `Unsupported Prettier ${metadata.version}: the format API is not available`,
    );
  }

  return {
    prettier,
    version: metadata.version,
  };
}

function resolveIgnorePaths(root) {
  return ['.gitignore', '.prettierignore']
    .map((file) => path.join(root, file))
    .filter((file) => existsSync(file));
}

export async function resolveProjectPrettierConfigFile(root) {
  const { prettier } = await loadProjectPrettier(root);
  return await prettier.resolveConfigFile(path.join(root, 'package.json'));
}

async function prepareFormatting(prettier, root, files, requireConfig) {
  const ignorePaths = resolveIgnorePaths(root);
  const formatting = [];
  let ignoredCount = 0;

  for (const file of files) {
    const fileInfoOptions = {
      resolveConfig: true,
    };
    if (ignorePaths.length > 0) {
      fileInfoOptions.ignorePath = ignorePaths;
    }

    let fileInfo = await prettier.getFileInfo(file, fileInfoOptions);
    if (fileInfo.ignored) {
      ignoredCount += 1;
      continue;
    }

    const config = await prettier.resolveConfig(file, { editorconfig: true });
    if (requireConfig && config === null) {
      throw new Error(
        `Prettier configuration was not found for staged file: ${path.relative(root, file)}`,
      );
    }

    if (config?.plugins) {
      fileInfo = await prettier.getFileInfo(file, {
        ...fileInfoOptions,
        plugins: config.plugins,
      });
    }
    if (!fileInfo.inferredParser) {
      throw new Error(
        `Prettier could not infer a parser for staged file: ${path.relative(root, file)}`,
      );
    }

    const original = readFileSync(file, 'utf8');
    const formatted = await prettier.format(original, {
      ...config,
      filepath: file,
    });
    formatting.push({
      file,
      formatted,
      original,
    });
  }

  return {
    formatting,
    ignoredCount,
  };
}

export async function runPrettierFiles({
  root,
  files,
  fix,
  requireConfig,
}) {
  if (files.length === 0) {
    return 0;
  }

  const { prettier, version } = await loadProjectPrettier(root);
  const normalizedFiles = normalizeStagedFiles(root, files, 'Prettier')
    .map(({ absolute }) => absolute);
  const { formatting, ignoredCount } = await prepareFormatting(
    prettier,
    root,
    normalizedFiles,
    requireConfig,
  );
  const changed = formatting.filter(({ formatted, original }) => formatted !== original);

  if (changed.length === 0) {
    console.log(
      `Prettier ${version} passed: ${formatting.length} staged file(s)`
      + `${ignoredCount > 0 ? `, ${ignoredCount} ignored` : ''}.`,
    );
    return 0;
  }

  if (!fix) {
    for (const { file } of changed) {
      console.error(`Prettier formatting required: ${path.relative(root, file)}`);
    }
    console.error('Prettier failed and automatic formatting is disabled.');
    return 1;
  }

  const originalContents = captureFileContents(changed.map(({ file }) => file));
  try {
    for (const { file, formatted } of changed) {
      writeFileSync(file, formatted, 'utf8');
    }
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }

  console.log(
    `Prettier ${version} formatted ${changed.length} staged file(s)`
    + `${ignoredCount > 0 ? `; ${ignoredCount} ignored` : ''}.`,
  );
  return 0;
}
