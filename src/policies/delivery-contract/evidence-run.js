import path from 'node:path';
import { normalizeGitPath } from '../../config/path-matching.js';
import {
  collectContractRevisionChanges,
  commitExists,
  isAncestorCommit,
} from '../../git/delivery-contract-facts.js';
import {
  calculateGateResultDigest,
  sha256Digest,
} from './digests.js';
import { parseMarkdownFrontmatter } from './markdown.js';

const COMMIT = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_ID = /^EVD-[A-Z0-9-]+$/;
const EXECUTION_ID = /^EXEC-[A-Z0-9-]+$/;
const RUN_ID = /^RUN-[A-Z0-9-]+$/;
const ISO_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const GATE_STATUSES = new Set([
  'passed',
  'skipped',
  'violation',
  'configuration-error',
  'execution-error',
  'range-error',
]);

function append(issues, rule, message, filePath = null) {
  issues.push({ rule, message, path: filePath });
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label, issues, filePath) {
  if (!isObject(value)) {
    append(issues, 'delivery-evidence/run-schema', `${label} 必须是对象`, filePath);
    return false;
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    append(
      issues,
      'delivery-evidence/run-schema',
      `${label} 包含不支持的字段：${unknown.join(', ')}`,
      filePath,
    );
  }
  return true;
}

function nonEmpty(value, label, issues, filePath) {
  if (typeof value !== 'string' || value.trim() === '') {
    append(issues, 'delivery-evidence/run-schema', `${label} 必须是非空字符串`, filePath);
    return false;
  }
  return true;
}

function safeRepositoryPath(value, label, issues, filePath) {
  if (!nonEmpty(value, label, issues, filePath)) return null;
  const normalized = normalizeGitPath(value.trim());
  if (
    path.isAbsolute(value)
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').includes('..')
  ) {
    append(
      issues,
      'delivery-evidence/unsafe-path',
      `${label} 必须是安全的仓库内相对路径`,
      filePath,
    );
    return null;
  }
  return normalized;
}

function commaSeparatedIds(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function changedPathSet(changes) {
  return [...new Set(changes.flatMap(({ oldPath, path: filePath }) => (
    [oldPath, filePath].filter(Boolean)
  )))].sort();
}

function verifyTrackedFile({ digest, inspection, issues, label, relativePath, runPath }) {
  const filePath = safeRepositoryPath(relativePath, `${label}.path`, issues, runPath);
  if (!filePath) return null;
  const contractRoot = `${path.posix.dirname(inspection.selected.path)}/${inspection.selected.parsed.data.contractId}`;
  if (!filePath.startsWith(`${contractRoot}/evidence/`)) {
    append(
      issues,
      'delivery-evidence/file-outside-contract',
      `${label}.path 必须位于 ${contractRoot}/evidence/`,
      filePath,
    );
  }
  if (!inspection.loader.trackedFiles.has(filePath)) {
    append(issues, 'delivery-evidence/file-not-tracked', `${label}.path 未受 Git 跟踪：${filePath}`, filePath);
    return filePath;
  }
  if (!DIGEST.test(digest ?? '')) {
    append(issues, 'delivery-evidence/file-digest', `${label}.digest 必须是 sha256 指纹`, filePath);
    return filePath;
  }
  try {
    const actual = sha256Digest(inspection.loader.readBuffer(filePath));
    if (actual !== digest) {
      append(
        issues,
        'delivery-evidence/file-digest-mismatch',
        `${label}.digest 与文件字节不一致；当前计算值为 ${actual}`,
        filePath,
      );
    }
  } catch (error) {
    append(issues, 'delivery-evidence/file-read-failed', `无法读取证据文件 ${filePath}：${error.message}`, filePath);
  }
  return filePath;
}

function validateGateResults(value, issues, runPath) {
  const byId = new Map();
  if (!Array.isArray(value)) {
    append(issues, 'delivery-evidence/run-schema', 'evidenceRun.gateResults 必须是数组', runPath);
    return byId;
  }
  value.forEach((entry, index) => {
    const label = `evidenceRun.gateResults[${index}]`;
    if (!exactKeys(entry, ['gateId', 'resultDigest', 'result'], label, issues, runPath)) return;
    if (!nonEmpty(entry.gateId, `${label}.gateId`, issues, runPath)) return;
    if (byId.has(entry.gateId)) {
      append(issues, 'delivery-evidence/duplicate-gate-result', `重复记录 GateResult：${entry.gateId}`, runPath);
      return;
    }
    if (!DIGEST.test(entry.resultDigest ?? '')) {
      append(issues, 'delivery-evidence/gate-result-digest', `${label}.resultDigest 必须是 sha256 指纹`, runPath);
    }
    if (!exactKeys(
      entry.result,
      ['gateId', 'status', 'summary', 'findings', 'artifacts', 'metrics', 'error', 'diagnostics'],
      `${label}.result`,
      issues,
      runPath,
    )) return;
    if (entry.result.gateId !== entry.gateId) {
      append(issues, 'delivery-evidence/gate-result-id', `${label}.result.gateId 必须与 gateId 一致`, runPath);
    }
    if (!GATE_STATUSES.has(entry.result.status)) {
      append(issues, 'delivery-evidence/gate-result-status', `${label}.result.status 不受支持`, runPath);
    }
    nonEmpty(entry.result.summary, `${label}.result.summary`, issues, runPath);
    for (const field of ['findings', 'artifacts', 'diagnostics']) {
      if (!Array.isArray(entry.result[field])) {
        append(issues, 'delivery-evidence/run-schema', `${label}.result.${field} 必须是数组`, runPath);
      }
    }
    if (!isObject(entry.result.metrics)) {
      append(issues, 'delivery-evidence/run-schema', `${label}.result.metrics 必须是对象`, runPath);
    }
    const actualDigest = calculateGateResultDigest(entry.result);
    if (actualDigest !== entry.resultDigest) {
      append(
        issues,
        'delivery-evidence/gate-result-digest-mismatch',
        `${entry.gateId} 的 GateResult 内容指纹不一致；当前计算值为 ${actualDigest}`,
        runPath,
      );
    }
    byId.set(entry.gateId, entry);
  });
  return byId;
}

function validateExecutionLog(value, { inspection, issues, runPath }) {
  const byId = new Map();
  if (!Array.isArray(value)) {
    append(issues, 'delivery-evidence/run-schema', 'evidenceRun.executionLog 必须是数组', runPath);
    return byId;
  }
  value.forEach((entry, index) => {
    const label = `evidenceRun.executionLog[${index}]`;
    if (!exactKeys(
      entry,
      ['id', 'occurredAt', 'commandId', 'subjectCommit', 'exitCode', 'reportPath', 'resultDigest'],
      label,
      issues,
      runPath,
    )) return;
    if (!EXECUTION_ID.test(entry.id ?? '')) {
      append(issues, 'delivery-evidence/execution-id', `${label}.id 必须以 EXEC- 开头`, runPath);
    } else if (byId.has(entry.id)) {
      append(issues, 'delivery-evidence/duplicate-execution', `执行日志 id 重复：${entry.id}`, runPath);
    }
    if (!ISO_TIMEZONE.test(entry.occurredAt ?? '')) {
      append(issues, 'delivery-evidence/execution-time', `${label}.occurredAt 必须是带时区的 ISO 8601 时间`, runPath);
    }
    nonEmpty(entry.commandId, `${label}.commandId`, issues, runPath);
    if (!COMMIT.test(entry.subjectCommit ?? '') || !commitExists(inspection.root, entry.subjectCommit)) {
      append(issues, 'delivery-evidence/execution-commit', `${label}.subjectCommit 必须是仓库中存在的完整提交`, runPath);
    }
    if (!Number.isInteger(entry.exitCode)) {
      append(issues, 'delivery-evidence/execution-exit-code', `${label}.exitCode 必须是整数`, runPath);
    }
    verifyTrackedFile({
      digest: entry.resultDigest,
      inspection,
      issues,
      label,
      relativePath: entry.reportPath,
      runPath,
    });
    byId.set(entry.id, entry);
  });
  return byId;
}

function validateCommitEvidence(entry, label, context) {
  const { inspection, issues, runPath, subjectCommit } = context;
  if (!COMMIT.test(entry.commit ?? '') || !commitExists(inspection.root, entry.commit)) {
    append(issues, 'delivery-evidence/commit-record', `${label}.commit 必须是仓库中存在的完整提交`, runPath);
    return;
  }
  if (!isAncestorCommit(inspection.root, entry.commit, subjectCommit)) {
    append(issues, 'delivery-evidence/commit-not-in-subject', `${label}.commit 不属于被验收代码历史`, runPath);
  }
  if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
    append(issues, 'delivery-evidence/commit-paths', `${label}.paths 必须是非空数组`, runPath);
    return;
  }
  const declared = entry.paths
    .map((item, index) => safeRepositoryPath(item, `${label}.paths[${index}]`, issues, runPath))
    .filter(Boolean);
  try {
    const changed = changedPathSet(collectContractRevisionChanges(
      inspection.root,
      `${entry.commit}^`,
      entry.commit,
    ));
    const unchanged = declared.filter((filePath) => !changed.includes(filePath));
    if (unchanged.length > 0) {
      append(
        issues,
        'delivery-evidence/commit-path-not-changed',
        `${label}.paths 包含该提交未修改的路径：${unchanged.join(', ')}`,
        runPath,
      );
    }
  } catch (error) {
    append(issues, 'delivery-evidence/commit-read-failed', `无法复核提交 ${entry.commit}：${error.message}`, runPath);
  }
}

function validateEvidenceRecords(value, context) {
  const { gateResults, inspection, issues, runPath, executions } = context;
  const byId = new Map();
  if (!Array.isArray(value) || value.length === 0) {
    append(issues, 'delivery-evidence/run-schema', 'evidenceRun.evidence 必须是非空数组', runPath);
    return byId;
  }
  value.forEach((entry, index) => {
    const label = `evidenceRun.evidence[${index}]`;
    if (!isObject(entry)) {
      append(issues, 'delivery-evidence/run-schema', `${label} 必须是对象`, runPath);
      return;
    }
    const typeKeys = {
      commit: ['id', 'type', 'description', 'commit', 'paths'],
      execution: ['id', 'type', 'description', 'executionId'],
      file: ['id', 'type', 'description', 'path', 'digest'],
      'gate-result': ['id', 'type', 'description', 'gateId', 'resultDigest'],
    };
    if (!Object.hasOwn(typeKeys, entry.type)) {
      append(issues, 'delivery-evidence/record-type', `${label}.type 不受支持`, runPath);
      return;
    }
    exactKeys(entry, typeKeys[entry.type], label, issues, runPath);
    if (!EVIDENCE_ID.test(entry.id ?? '')) {
      append(issues, 'delivery-evidence/record-id', `${label}.id 必须以 EVD- 开头`, runPath);
    } else if (byId.has(entry.id)) {
      append(issues, 'delivery-evidence/duplicate-record', `证据 id 重复：${entry.id}`, runPath);
    }
    nonEmpty(entry.description, `${label}.description`, issues, runPath);
    if (entry.type === 'file') {
      verifyTrackedFile({
        digest: entry.digest,
        inspection,
        issues,
        label,
        relativePath: entry.path,
        runPath,
      });
    } else if (entry.type === 'commit') {
      validateCommitEvidence(entry, label, context);
    } else if (entry.type === 'execution') {
      if (!executions.has(entry.executionId)) {
        append(issues, 'delivery-evidence/execution-reference', `${label}.executionId 未引用执行日志`, runPath);
      }
    } else {
      const gateResult = gateResults.get(entry.gateId);
      if (!gateResult || gateResult.resultDigest !== entry.resultDigest) {
        append(issues, 'delivery-evidence/gate-reference', `${label} 未引用匹配的 GateResult`, runPath);
      }
    }
    byId.set(entry.id, entry);
  });
  return byId;
}

function validateIntegrationAnalysis(data, inspection, issues, runPath) {
  const drifted = data.targetCommit !== data.baselineCommit;
  if (!drifted && data.integrationAnalysis == null) return;
  const analysis = data.integrationAnalysis;
  if (!exactKeys(
    analysis,
    ['fromCommit', 'toCommit', 'changedPaths', 'impact', 'summary', 'confirmation'],
    'evidenceRun.integrationAnalysis',
    issues,
    runPath,
  )) return;
  if (analysis.fromCommit !== data.baselineCommit || analysis.toCommit !== data.targetCommit) {
    append(
      issues,
      'delivery-evidence/integration-analysis-binding',
      '集成影响分析必须绑定合同基线和当前目标分支提交',
      runPath,
    );
  }
  if (!['none', 'contract-change'].includes(analysis.impact)) {
    append(issues, 'delivery-evidence/integration-impact', 'integrationAnalysis.impact 必须为 none 或 contract-change', runPath);
  }
  nonEmpty(analysis.summary, 'integrationAnalysis.summary', issues, runPath);
  if (!Array.isArray(analysis.changedPaths)) {
    append(issues, 'delivery-evidence/integration-paths', 'integrationAnalysis.changedPaths 必须是数组', runPath);
  } else if (COMMIT.test(data.baselineCommit) && COMMIT.test(data.targetCommit)) {
    try {
      const actual = changedPathSet(collectContractRevisionChanges(
        inspection.root,
        data.baselineCommit,
        data.targetCommit,
      ));
      const declared = [...new Set(analysis.changedPaths.map((value) => normalizeGitPath(value)))].sort();
      if (JSON.stringify(actual) !== JSON.stringify(declared)) {
        append(
          issues,
          'delivery-evidence/integration-paths-mismatch',
          `目标分支漂移路径不一致；当前 Git 计算结果为 ${actual.join(', ') || '<无>'}`,
          runPath,
        );
      }
    } catch (error) {
      append(issues, 'delivery-evidence/integration-paths-failed', `无法复核目标分支漂移路径：${error.message}`, runPath);
    }
  }
  const confirmation = analysis.confirmation;
  if (!exactKeys(
    confirmation,
    ['status', 'confirmedAt', 'confirmedBy', 'targetCommit', 'contractRevision', 'definitionDigest'],
    'integrationAnalysis.confirmation',
    issues,
    runPath,
  )) return;
  if (confirmation.status !== 'confirmed') {
    append(issues, 'delivery-evidence/integration-confirmation', '目标分支漂移影响分析必须由人工确认', runPath);
  }
  nonEmpty(confirmation.confirmedBy, 'integrationAnalysis.confirmation.confirmedBy', issues, runPath);
  if (!ISO_TIMEZONE.test(confirmation.confirmedAt ?? '')) {
    append(issues, 'delivery-evidence/integration-confirmation', '目标分支漂移确认时间必须是带时区的 ISO 8601 时间', runPath);
  }
  if (
    confirmation.targetCommit !== data.targetCommit
    || confirmation.contractRevision !== data.contractRevision
    || confirmation.definitionDigest !== data.definitionDigest
  ) {
    append(issues, 'delivery-evidence/integration-confirmation-binding', '目标分支漂移确认未绑定当前目标提交、合同修订和定义指纹', runPath);
  }
}

function validateRunBindings(data, inspection, evidence, issues, runPath) {
  const contract = inspection.selected.parsed.data;
  const expected = {
    artifactPlanDigest: inspection.artifactPlanDigest,
    baselineCommit: contract.repository.baselineCommit,
    contractId: contract.contractId,
    contractRevision: contract.contractRevision,
    definitionDigest: inspection.definitionDigest,
    integrationBaseCommit: evidence.integrationBaseCommit,
    requirementFactsDigest: inspection.requirementFactsDigest,
    requirementsRevision: contract.requirements.revision,
    sourceBundleDigest: inspection.sourceBundleDigest,
    subjectCommit: evidence.subjectCommit,
    targetBranch: contract.repository.targetBranch,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (data[field] !== expectedValue) {
      append(
        issues,
        'delivery-evidence/run-binding',
        `evidenceRun.${field} 未绑定当前合同或交付证据`,
        runPath,
      );
    }
  }
  if (data.integrationBaseCommit !== data.targetCommit) {
    append(issues, 'delivery-evidence/integration-base-target', '最终集成基线必须等于证据批次记录的目标分支提交', runPath);
  }
  if (inspection.targetBranchCommit && data.targetCommit !== inspection.targetBranchCommit.commit) {
    append(
      issues,
      'delivery-evidence/target-branch-drifted',
      `目标分支 ${contract.repository.targetBranch} 已从证据批次记录的提交继续前进`,
      runPath,
    );
  }
}

function validateRunShape(data, issues, runPath) {
  const allowed = [
    'schemaVersion',
    'runId',
    'generatedAt',
    'contractId',
    'contractRevision',
    'definitionDigest',
    'baselineCommit',
    'requirementsRevision',
    'sourceBundleDigest',
    'requirementFactsDigest',
    'artifactPlanDigest',
    'targetBranch',
    'targetCommit',
    'integrationBaseCommit',
    'subjectCommit',
    'integrationAnalysis',
    'gateResults',
    'executionLog',
    'evidence',
  ];
  if (!exactKeys(data, allowed, 'evidenceRun', issues, runPath)) return false;
  for (const field of allowed.filter((key) => key !== 'integrationAnalysis')) {
    if (!Object.hasOwn(data, field)) {
      append(issues, 'delivery-evidence/run-schema', `evidenceRun 缺少必填字段：${field}`, runPath);
    }
  }
  if (data.schemaVersion !== 2) append(issues, 'delivery-evidence/run-schema', 'evidenceRun.schemaVersion 必须为 2', runPath);
  if (!RUN_ID.test(data.runId ?? '')) append(issues, 'delivery-evidence/run-id', 'evidenceRun.runId 必须以 RUN- 开头', runPath);
  if (!ISO_TIMEZONE.test(data.generatedAt ?? '')) {
    append(issues, 'delivery-evidence/run-time', 'evidenceRun.generatedAt 必须是带时区的 ISO 8601 时间', runPath);
  }
  if (!Number.isInteger(data.contractRevision) || data.contractRevision < 1) {
    append(issues, 'delivery-evidence/run-revision', 'evidenceRun.contractRevision 必须是正整数', runPath);
  }
  if (!Number.isInteger(data.requirementsRevision) || data.requirementsRevision < 1) {
    append(issues, 'delivery-evidence/run-revision', 'evidenceRun.requirementsRevision 必须是正整数', runPath);
  }
  for (const field of ['definitionDigest', 'sourceBundleDigest', 'requirementFactsDigest', 'artifactPlanDigest']) {
    if (!DIGEST.test(data[field] ?? '')) {
      append(issues, 'delivery-evidence/run-digest', `evidenceRun.${field} 必须是 sha256 指纹`, runPath);
    }
  }
  for (const field of ['baselineCommit', 'targetCommit', 'integrationBaseCommit', 'subjectCommit']) {
    if (!COMMIT.test(data[field] ?? '')) {
      append(issues, 'delivery-evidence/run-commit', `evidenceRun.${field} 必须是完整 Git 提交哈希`, runPath);
    }
  }
  nonEmpty(data.contractId, 'evidenceRun.contractId', issues, runPath);
  nonEmpty(data.targetBranch, 'evidenceRun.targetBranch', issues, runPath);
  return true;
}

export function inspectEvidenceRun({ evidence, inspection, issues }) {
  const runPath = safeRepositoryPath(
    evidence.evidenceRunPath,
    'deliveryEvidence.evidenceRunPath',
    issues,
    inspection.selected.path,
  );
  if (!runPath) return null;
  const contractRoot = `${path.posix.dirname(inspection.selected.path)}/${inspection.selected.parsed.data.contractId}`;
  if (!runPath.startsWith(`${contractRoot}/evidence/runs/`) || !runPath.endsWith('.md')) {
    append(
      issues,
      'delivery-evidence/run-path',
      `证据批次必须是 ${contractRoot}/evidence/runs/ 下的 Markdown 文件`,
      runPath,
    );
  }
  if (!inspection.loader.trackedFiles.has(runPath)) {
    append(issues, 'delivery-evidence/run-not-tracked', `证据批次未受 Git 跟踪：${runPath}`, runPath);
    return null;
  }
  let source;
  try {
    source = inspection.loader.readBuffer(runPath);
  } catch (error) {
    append(issues, 'delivery-evidence/run-read-failed', `无法读取证据批次：${error.message}`, runPath);
    return null;
  }
  const digest = sha256Digest(source);
  if (evidence.evidenceRunDigest !== digest) {
    append(
      issues,
      'delivery-evidence/run-digest-mismatch',
      `证据批次文件指纹不一致；当前计算值为 ${digest}`,
      runPath,
    );
  }
  const parsed = parseMarkdownFrontmatter(source.toString('utf8'));
  parsed.errors.forEach((message) => append(issues, 'delivery-evidence/run-markdown', message, runPath));
  if (!parsed.data || !validateRunShape(parsed.data, issues, runPath)) return null;
  validateRunBindings(parsed.data, inspection, evidence, issues, runPath);
  validateIntegrationAnalysis(parsed.data, inspection, issues, runPath);
  const gateResults = validateGateResults(parsed.data.gateResults, issues, runPath);
  const executions = validateExecutionLog(parsed.data.executionLog, {
    inspection,
    issues,
    runPath,
  });
  const evidenceById = validateEvidenceRecords(parsed.data.evidence, {
    executions,
    gateResults,
    inspection,
    issues,
    runPath,
    subjectCommit: parsed.data.subjectCommit,
  });
  return {
    data: parsed.data,
    digest,
    evidenceById,
    executions,
    gateResults,
    path: runPath,
  };
}

export function evidenceReferences(value) {
  return commaSeparatedIds(value);
}
