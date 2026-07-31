import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function projectRequire(root) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json was not found in repository root: ${root}`);
  }
  return createRequire(packageJsonPath);
}

export function resolveProjectEslintMetadata(root) {
  const requireFromProject = projectRequire(root);
  let packagePath;
  let entryPath;

  try {
    packagePath = requireFromProject.resolve('eslint/package.json');
    entryPath = requireFromProject.resolve('eslint');
  } catch {
    throw new Error(
      'ESLint is enabled but is not installed by this project. '
      + 'Install eslint as a project devDependency.',
    );
  }

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  return {
    entryPath,
    packagePath,
    version: packageJson.version || 'unknown',
  };
}

async function loadProjectEslint(root) {
  const metadata = resolveProjectEslintMetadata(root);
  const eslintModule = await import(pathToFileURL(metadata.entryPath).href);
  const ESLint = eslintModule.ESLint || eslintModule.default?.ESLint;

  if (typeof ESLint !== 'function') {
    throw new Error(
      `Unsupported ESLint ${metadata.version}: the ESLint class is not available`,
    );
  }

  return {
    ESLint,
    version: metadata.version,
  };
}

function normalizeFiles(root, files) {
  return [...new Set(files)].map((file) => {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`ESLint staged file is outside the repository: ${file}`);
    }
    return absolute;
  });
}

async function collectLintableFiles(eslint, files) {
  const lintable = [];
  for (const file of files) {
    if (!(await eslint.isPathIgnored(file))) {
      lintable.push(file);
    }
  }
  return lintable;
}

function summarize(results) {
  return results.reduce(
    (summary, result) => ({
      errors: summary.errors + result.errorCount,
      fatalErrors: summary.fatalErrors + result.fatalErrorCount,
      warnings: summary.warnings + result.warningCount,
    }),
    { errors: 0, fatalErrors: 0, warnings: 0 },
  );
}

function hasBlockingProblems(summary, maxWarnings) {
  return summary.errors > 0 || summary.warnings > maxWarnings;
}

async function printResults(eslint, results) {
  const formatter = await eslint.loadFormatter('stylish');
  const output = await formatter.format(results);
  if (output.trim()) {
    console.error(output.trimEnd());
  }
}

function captureFileContents(files) {
  return new Map(files.map((file) => [file, readFileSync(file)]));
}

function restoreFileContents(contents) {
  for (const [file, content] of contents) {
    writeFileSync(file, content);
  }
}

export async function runEslintFiles({
  root,
  files,
  fix,
  maxWarnings,
}) {
  if (files.length === 0) {
    return 0;
  }

  const { ESLint, version } = await loadProjectEslint(root);
  const normalizedFiles = normalizeFiles(root, files);
  const initialEslint = new ESLint({ cwd: root, fix: false });
  const lintableFiles = await collectLintableFiles(initialEslint, normalizedFiles);

  if (lintableFiles.length === 0) {
    console.log(`ESLint ${version}: all staged files are ignored by the project configuration.`);
    return 0;
  }

  const initialResults = await initialEslint.lintFiles(lintableFiles);
  const initialSummary = summarize(initialResults);
  if (!hasBlockingProblems(initialSummary, maxWarnings)) {
    console.log(`ESLint ${version} passed: ${lintableFiles.length} staged file(s).`);
    return 0;
  }

  if (!fix) {
    await printResults(initialEslint, initialResults);
    console.error('ESLint failed and automatic fixes are disabled.');
    return 1;
  }

  const fixingEslint = new ESLint({ cwd: root, fix: true });
  const originalContents = captureFileContents(lintableFiles);
  let finalEslint;
  let finalResults;

  try {
    const fixedResults = await fixingEslint.lintFiles(lintableFiles);
    await ESLint.outputFixes(fixedResults);

    finalEslint = new ESLint({ cwd: root, fix: false });
    finalResults = await finalEslint.lintFiles(lintableFiles);
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }

  const finalSummary = summarize(finalResults);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    await printResults(finalEslint, finalResults);
    console.error(
      `ESLint auto-fix did not resolve all problems `
      + `(${finalSummary.errors} error(s), ${finalSummary.warnings} warning(s)).`,
    );
    return 1;
  }

  console.log(
    `ESLint ${version} auto-fix and verification passed: `
    + `${lintableFiles.length} staged file(s).`,
  );
  return 0;
}
