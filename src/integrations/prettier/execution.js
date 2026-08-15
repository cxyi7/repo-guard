import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { normalizeStagedFiles } from '../../core/execution/staged-files.js';

function resolveIgnorePaths(root) {
  return ['.gitignore', '.prettierignore']
    .map((file) => path.join(root, file))
    .filter((file) => existsSync(file));
}

export function prepareProjectPrettierExecution({ root, files, project }) {
  const ignorePaths = resolveIgnorePaths(root);
  const normalizedFiles = normalizeStagedFiles(root, files, 'Prettier')
    .map(({ absolute }) => absolute);

  return {
    files: normalizedFiles,
    async inspect(file) {
      const fileInfoOptions = { resolveConfig: true };
      if (ignorePaths.length > 0) {
        fileInfoOptions.ignorePath = ignorePaths;
      }

      let fileInfo = await project.prettier.getFileInfo(file, fileInfoOptions);
      if (fileInfo.ignored) {
        return { file, ignored: true };
      }

      const config = await project.prettier.resolveConfig(file, { editorconfig: true });
      if (config?.plugins) {
        fileInfo = await project.prettier.getFileInfo(file, {
          ...fileInfoOptions,
          plugins: config.plugins,
        });
      }
      return {
        config,
        file,
        ignored: false,
        inferredParser: fileInfo.inferredParser,
      };
    },
    async format({ config, file }) {
      const original = readFileSync(file, 'utf8');
      const formatted = await project.prettier.format(original, {
        ...config,
        filepath: file,
      });
      return { file, formatted, original };
    },
  };
}

export function writeProjectPrettierFiles(changes) {
  for (const { file, formatted } of changes) {
    writeFileSync(file, formatted, 'utf8');
  }
}
