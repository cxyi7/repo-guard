import path from 'node:path';
import { captureFileContents, restoreFileContents } from '../../file-snapshot.js';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  prepareProjectPrettierExecution,
  writeProjectPrettierFiles,
} from '../../integrations/prettier/execution.js';
import { loadProjectPrettier } from '../../integrations/prettier/project.js';

export const PRETTIER_GATE_ID = 'quality.prettier';

async function collectFormatting(execution, root, requireConfig) {
  const formatting = [];
  let ignoredCount = 0;

  for (const file of execution.files) {
    const inspection = await execution.inspect(file);
    if (inspection.ignored) {
      ignoredCount += 1;
      continue;
    }
    if (requireConfig && inspection.config === null) {
      throw configurationError(
        'prettier/missing-project-config',
        `Prettier configuration was not found for staged file: ${path.relative(root, file)}`,
      );
    }
    if (!inspection.inferredParser) {
      throw configurationError(
        'prettier/parser-not-inferred',
        `Prettier could not infer a parser for staged file: ${path.relative(root, file)}`,
      );
    }
    formatting.push(await execution.format(inspection));
  }

  return { formatting, ignoredCount };
}

export async function runPrettierFiles({
  root,
  files,
  fix,
  requireConfig,
}) {
  if (files.length === 0) {
    return createGateResult({ gateId: PRETTIER_GATE_ID, status: 'skipped', summary: 'Prettier has no applicable files' });
  }

  const project = await loadProjectPrettier(root);
  const execution = prepareProjectPrettierExecution({ root, files, project });
  const { formatting, ignoredCount } = await collectFormatting(
    execution,
    root,
    requireConfig,
  );
  const changed = formatting.filter(({ formatted, original }) => formatted !== original);

  if (changed.length === 0) {
    return createGateResult({ gateId: PRETTIER_GATE_ID, status: 'passed', summary: `Prettier ${project.version} passed`, metrics: { checkedFiles: formatting.length, ignoredFiles: ignoredCount, changedFiles: 0 } });
  }

  if (!fix) {
    return createGateResult({ gateId: PRETTIER_GATE_ID, status: 'violation', summary: `Prettier requires formatting in ${changed.length} file(s)`, findings: changed.map(({ file }) => ({ ruleId: 'prettier/format', severity: 'error', message: 'File does not match the project Prettier configuration', location: { path: path.relative(root, file).replace(/\\/g, '/') }, remediation: 'Run the project Prettier formatter and stage the result.' })), metrics: { checkedFiles: formatting.length, ignoredFiles: ignoredCount, changedFiles: changed.length } });
  }

  const originalContents = captureFileContents(changed.map(({ file }) => file));
  try {
    writeProjectPrettierFiles(changed);
  } catch (error) {
    restoreFileContents(originalContents);
    throw toRepoGuardError(error, {
      kind: 'execution',
      code: 'prettier/execution-failed',
    });
  }

  return createGateResult({ gateId: PRETTIER_GATE_ID, status: 'passed', summary: `Prettier ${project.version} formatted ${changed.length} file(s)`, metrics: { checkedFiles: formatting.length, ignoredFiles: ignoredCount, changedFiles: changed.length } });
}
