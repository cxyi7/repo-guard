import { fileURLToPath } from 'node:url';
import { executionError } from '../../core/error/repo-guard-error.js';
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
  return issueTypes.flatMap((type) => KNIP_ISSUE_TYPES_BY_POLICY_TYPE[type] ?? [type]);
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
  if (!metadata || !Number.isInteger(metadata.configurationHintCount)
    || metadata.configurationHintCount < 0) {
    throw executionError('dead-code/invalid-knip-metadata', 'Knip 配置提示数量无效');
  }
  return Object.freeze({
    report: output.slice(0, markerIndex).trim(),
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
  if (setup.configFile) argumentsList.push('--config', setup.configFile);
  if (config.production) argumentsList.push('--production');
  if (config.treatConfigHintsAsErrors) argumentsList.push('--treat-config-hints-as-errors');
  argumentsList.push('--include', knipIssueTypes(config.issueTypes).join(','));
  const execution = await runStreamingProcess({
    command: process.execPath,
    argumentsList,
    root,
    timeoutMs: config.timeoutMs,
    signal,
    captureLimit: CAPTURE_LIMIT,
  });
  if (execution.timedOut) {
    throw executionError('dead-code/timeout', `Knip 分析超过 ${config.timeoutMs}ms`);
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
      `Knip 执行失败，退出码为 ${String(execution.status)}`,
    );
  }
  const output = parseExecutionOutput(execution.stdout);
  const issues = parseKnipJsonReport(output.report, config.issueTypes);
  return Object.freeze({
    configurationHintCount: output.configurationHintCount,
    execution,
    issues,
    setup,
  });
}
