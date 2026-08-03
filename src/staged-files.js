import path from 'node:path';

export function normalizeStagedFiles(root, files, label) {
  const uniqueFiles = new Map();

  for (const file of files) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label} staged file is outside the repository: ${file}`);
    }

    uniqueFiles.set(absolute, {
      absolute,
      relative: relative.replace(/\\/g, '/'),
    });
  }

  return [...uniqueFiles.values()];
}
