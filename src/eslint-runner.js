import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { buildEslintAiRepairInstructions } from './eslint-diagnostics.js';
import { createRepoGuardEslintConfig } from './eslint-config.js';
import { resolveProjectPackageMetadata } from './project-package.js';
import { normalizeStagedFiles } from './staged-files.js';
import { createGateResult } from './core/result/gate-result.js';

export const ESLINT_GATE_ID = 'quality.eslint';

const MINIMUM_PRESET_ESLINT_VERSION = Object.freeze([9, 19]);

export function resolveProjectEslintMetadata(root) {
  return resolveProjectPackageMetadata(root, 'eslint', 'ESLint');
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

function normalizeImportedModule(module) {
  return module.default ?? module;
}

async function loadProjectIntegration(root, packageName, displayName, required) {
  let metadata;
  try {
    metadata = resolveProjectPackageMetadata(root, packageName, displayName);
  } catch (error) {
    if (!required && /is enabled but is not installed/.test(error.message)) {
      return null;
    }
    throw error;
  }

  const imported = await import(pathToFileURL(metadata.entryPath).href);
  return {
    module: normalizeImportedModule(imported),
    version: metadata.version,
  };
}

function supportsRepoGuardPreset(version) {
  const [major, minor] = String(version).split('.').map(Number);
  const [minimumMajor, minimumMinor] = MINIMUM_PRESET_ESLINT_VERSION;
  return major > minimumMajor
    || (major === minimumMajor && minor >= minimumMinor);
}

export async function resolveRepoGuardEslintPreset(root, eslintVersion) {
  if (!supportsRepoGuardPreset(eslintVersion)) {
    throw new Error(
      `repo-guard ESLint preset requires ESLint >=9.19; project has ${eslintVersion}`,
    );
  }

  const js = await loadProjectIntegration(root, '@eslint/js', '@eslint/js', true);
  const vue = await loadProjectIntegration(
    root,
    'eslint-plugin-vue',
    'eslint-plugin-vue',
    false,
  );
  const typescript = await loadProjectIntegration(
    root,
    'typescript-eslint',
    'typescript-eslint',
    false,
  );

  return {
    configs: createRepoGuardEslintConfig({
      js: js.module,
      vue: vue?.module ?? null,
      typescript: typescript?.module ?? null,
    }),
    integrations: [
      `@eslint/js ${js.version}`,
      ...(vue ? [`eslint-plugin-vue ${vue.version}`] : []),
      ...(typescript ? [`typescript-eslint ${typescript.version}`] : []),
    ],
  };
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

function blockingFindings(root, results, maxWarnings) {
  const warningCount = results.reduce((total, result) => total + result.warningCount, 0);
  const warningsAreBlocking = warningCount > maxWarnings;
  return results.flatMap((result) => result.messages
    .filter((message) => message.severity === 2 || (warningsAreBlocking && message.severity === 1))
    .map((message) => ({
      ruleId: `eslint/${message.ruleId || 'parsing-error'}`,
      severity: message.severity === 1 ? 'warning' : 'error',
      message: String(message.message).trim(),
      location: {
        path: path.relative(root, result.filePath).replace(/\\/g, '/'),
        ...(message.line ? { line: message.line } : {}),
        ...(message.column ? { column: message.column } : {}),
      },
    })));
}

export async function runEslintFiles({
  root,
  files,
  fix,
  maxWarnings,
  preset = false,
}) {
  if (files.length === 0) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'skipped', summary: 'ESLint has no applicable files' });
  }

  const { ESLint, version } = await loadProjectEslint(root);
  const repoGuardPreset = preset
    ? await resolveRepoGuardEslintPreset(root, version)
    : null;
  const eslintOptions = (fixEnabled) => ({
    cwd: root,
    fix: fixEnabled,
    ...(repoGuardPreset ? { baseConfig: repoGuardPreset.configs } : {}),
  });
  const normalizedFiles = normalizeStagedFiles(root, files, 'ESLint')
    .map(({ absolute }) => absolute);
  const initialEslint = new ESLint(eslintOptions(false));
  const lintableFiles = await collectLintableFiles(initialEslint, normalizedFiles);

  if (lintableFiles.length === 0) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'skipped', summary: `ESLint ${version}: all files are ignored by the project configuration` });
  }

  const initialResults = await initialEslint.lintFiles(lintableFiles);
  const initialSummary = summarize(initialResults);
  if (!hasBlockingProblems(initialSummary, maxWarnings)) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'passed', summary: `ESLint ${version} passed`, metrics: { checkedFiles: lintableFiles.length, errors: 0, warnings: initialSummary.warnings } });
  }

  if (!fix) {
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'violation', summary: `ESLint found ${initialSummary.errors} error(s) and ${initialSummary.warnings} warning(s)`, findings: blockingFindings(root, initialResults, maxWarnings), diagnostics: [{ level: 'error', message: buildEslintAiRepairInstructions({ root, results: initialResults, maxWarnings }) }], metrics: { checkedFiles: lintableFiles.length, errors: initialSummary.errors, warnings: initialSummary.warnings } });
  }

  const fixingEslint = new ESLint(eslintOptions(true));
  const originalContents = captureFileContents(lintableFiles);
  let finalEslint;
  let finalResults;

  try {
    const fixedResults = await fixingEslint.lintFiles(lintableFiles);
    await ESLint.outputFixes(fixedResults);

    finalEslint = new ESLint(eslintOptions(false));
    finalResults = await finalEslint.lintFiles(lintableFiles);
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }

  const finalSummary = summarize(finalResults);
  if (hasBlockingProblems(finalSummary, maxWarnings)) {
    restoreFileContents(originalContents);
    return createGateResult({ gateId: ESLINT_GATE_ID, status: 'violation', summary: `ESLint auto-fix left ${finalSummary.errors} error(s) and ${finalSummary.warnings} warning(s)`, findings: blockingFindings(root, finalResults, maxWarnings), diagnostics: [{ level: 'error', message: buildEslintAiRepairInstructions({ root, results: finalResults, maxWarnings }) }], metrics: { checkedFiles: lintableFiles.length, errors: finalSummary.errors, warnings: finalSummary.warnings } });
  }

  return createGateResult({ gateId: ESLINT_GATE_ID, status: 'passed', summary: `ESLint ${version} auto-fix and verification passed`, metrics: { checkedFiles: lintableFiles.length, errors: 0, warnings: finalSummary.warnings } });
}
