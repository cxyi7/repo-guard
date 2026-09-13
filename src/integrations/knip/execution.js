import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { prepareKnipConfiguration } from './temporary-configuration.js';
import { filterSpecialDependencyIssues } from './special-references.js';
import { fileURLToPath } from 'node:url';
import {
  configurationError,
  executionError,
} from '../../core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../core/execution/streaming-process.js';
import { KNIP_METADATA_MARKER } from './configuration-hint-reporter.js';
import { resolveProjectKnip } from './project.js';
import { parseKnipJsonReport } from './report.js';

const CAPTURE_LIMIT = 64 * 1024 * 1024;
const KNIP_ISSUE_TYPES_BY_POLICY_TYPE = Object.freeze({
  dependencies: Object.freeze([
    'dependencies',
    'devDependencies',
    'optionalPeerDependencies',
  ]),
});
const METADATA_REPORTER_PATH = fileURLToPath(
  new URL('./configuration-hint-reporter.js', import.meta.url),
);

function knipIssueTypes(issueTypes) {
  return issueTypes.flatMap(
    (type) => KNIP_ISSUE_TYPES_BY_POLICY_TYPE[type] ?? [type],
  );
}

function parseExecutionOutput(output) {
  const delimiter = `\n${KNIP_METADATA_MARKER}`;
  const markerIndex = output.lastIndexOf(delimiter);
  if (markerIndex < 0) {
    throw executionError(
      'dead-code/missing-knip-metadata',
      'Knip 没有返回 repo-guard 要求的配置提示元数据',
    );
  }
  let metadata;
  try {
    metadata = JSON.parse(output.slice(markerIndex + delimiter.length).trim());
  } catch (error) {
    throw executionError(
      'dead-code/invalid-knip-metadata',
      `Knip 配置提示元数据无效：${error.message}`,
      { cause: error },
    );
  }
  if (
    !metadata ||
    !Number.isInteger(metadata.configurationHintCount) ||
    metadata.configurationHintCount < 0 ||
    !Number.isInteger(metadata.processedFiles) ||
    metadata.processedFiles < 0 ||
    !Number.isInteger(metadata.totalFiles) ||
    metadata.totalFiles < 0
  ) {
    throw executionError(
      'dead-code/invalid-knip-metadata',
      'Knip 配置提示和文件计数元数据无效',
    );
  }
  return Object.freeze({
    report: output.slice(0, markerIndex).trim(),
    processedFiles: metadata.processedFiles,
    totalFiles: metadata.totalFiles,
    configurationHintCount: metadata.configurationHintCount,
  });
}

export async function executeKnipAnalysis({ root, config, signal = null }) {
  const setup = resolveProjectKnip(root, config);
  const argumentsList = [
    setup.cliPath,
    '--reporter',
    'json',
    '--reporter',
    METADATA_REPORTER_PATH,
    '--no-progress',
  ];
  const prepared = prepareKnipConfiguration(root, config, setup);
  if (prepared.file) argumentsList.push('--config', prepared.file);
  if (config.production) argumentsList.push('--production');
  if (config.treatConfigHintsAsErrors)
    argumentsList.push('--treat-config-hints-as-errors');
  argumentsList.push('--include', knipIssueTypes(config.issueTypes).join(','));
  let execution;
  try {
    execution = await runStreamingProcess({
      command: process.execPath,
      argumentsList,
      root,
      timeoutMs: config.timeoutMs,
      signal,
      captureLimit: CAPTURE_LIMIT,
    });
  } finally {
    prepared.cleanup();
  }
  if (execution.timedOut) {
    throw executionError(
      'dead-code/timeout',
      `Knip 分析超过 ${config.timeoutMs}ms`,
    );
  }
  if (execution.error) {
    throw executionError(
      'dead-code/process-start-failed',
      `无法运行消费项目的 Knip：${execution.error.message}`,
      { cause: execution.error },
    );
  }
  if (![0, 1].includes(execution.status)) {
    throw executionError(
      'dead-code/process-failed',
      `Knip 执行失败，第三方退出码为 ${String(execution.status)}；详见原始诊断`,
      {
        details: {
          processCode: execution.status,
          diagnostics: processOutputDiagnostics(execution, {
            source: 'Knip 原始诊断',
            root,
          }),
        },
      },
    );
  }
  const output = parseExecutionOutput(execution.stdout);
  if (!Number.isInteger(output.processedFiles) || output.processedFiles <= 0)
    throw configurationError(
      'dead-code/empty-analysis',
      'Knip 没有实际分析任何入口可达源码，无法确认检查覆盖；请补齐真实入口、插件及扫描范围',
    );
  const parsed = parseKnipJsonReport(output.report, config.issueTypes);
  const { issues, skippedSpecialReferences } = filterSpecialDependencyIssues(
    root,
    parsed,
  );
  return Object.freeze({
    processedFiles: output.processedFiles,
    totalFiles: output.totalFiles,
    skippedSpecialReferences,
    configurationHintCount: output.configurationHintCount,
    execution,
    issues,
    setup,
  });
}
