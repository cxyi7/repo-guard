import {
  calculateDefinitionDigest,
  calculateExecutionDigest,
  calculateGateResultDigest,
  calculateTechnicalEvidenceDigest,
  sha256Digest,
} from './digests.js';
import { loadDeliveryContractBundle } from './contract-bundle.js';
import { inspectContractSchema } from './contract-schema.js';
import { evidenceReferences, inspectEvidenceRun } from './evidence-run.js';
import { createDeliveryContractRevisionLoader } from './loader.js';
import {
  collectContractRevisionChanges,
  commitExists,
  isAncestorCommit,
  trackedTreeIsClean,
} from '../../git/delivery-contract-facts.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ISO_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function append(issues, rule, message, path = null) {
  issues.push({ rule, message, path });
}

function validEvidence(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== 'pending';
}

function resolvedEvidence(value, evidenceRun, issues, label, contractPath) {
  const references = evidenceReferences(value);
  if (references.length === 0) {
    append(issues, 'delivery-evidence/evidence-missing', `${label} 缺少证据引用`, contractPath);
    return [];
  }
  return references.map((reference) => {
    const record = evidenceRun?.evidenceById.get(reference);
    if (!record) {
      append(
        issues,
        'delivery-evidence/evidence-reference',
        `${label} 引用了证据批次中不存在的 ${reference}`,
        contractPath,
      );
    }
    return record;
  }).filter(Boolean);
}

function validateEvidenceShape(value, issues, contractPath) {
  const allowed = new Set([
    'integrationBaseCommit',
    'subjectCommit',
    'definitionDigest',
    'sourceBundleDigest',
    'technicalEvidenceDigest',
    'executionDigest',
    'evidenceRunPath',
    'evidenceRunDigest',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    append(issues, 'delivery-evidence/missing', '合同缺少 deliveryEvidence 对象', contractPath);
    return false;
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    append(
      issues,
      'delivery-evidence/schema',
      `deliveryEvidence 包含不支持的字段：${unknown.join(', ')}`,
      contractPath,
    );
  }
  for (const field of ['integrationBaseCommit', 'subjectCommit']) {
    if (!COMMIT.test(value[field] ?? '')) {
      append(issues, 'delivery-evidence/commit', `deliveryEvidence.${field} 必须是完整 Git 提交哈希`, contractPath);
    }
  }
  for (const field of [
    'definitionDigest',
    'sourceBundleDigest',
    'technicalEvidenceDigest',
    'executionDigest',
    'evidenceRunDigest',
  ]) {
    if (!DIGEST.test(value[field] ?? '')) {
      append(issues, 'delivery-evidence/digest', `deliveryEvidence.${field} 必须是 sha256 指纹`, contractPath);
    }
  }
  if (!validEvidence(value.evidenceRunPath)) {
    append(issues, 'delivery-evidence/run-path', 'deliveryEvidence.evidenceRunPath 必须引用证据批次 Markdown', contractPath);
  }
  return true;
}

function validateCommitBinding(root, inspection, evidence, evidenceRun, issues) {
  const contractPath = inspection.selected.path;
  const allowedMetadataPaths = new Set([
    contractPath,
    evidence.evidenceRunPath,
    inspection.selected.parsed.componentPaths?.obligations,
    ...(inspection.selected.parsed.componentPaths?.findings ?? []),
    ...[...(evidenceRun?.executions?.values() ?? [])].map(({ reportPath }) => reportPath),
    ...[...(evidenceRun?.evidenceById?.values() ?? [])]
      .filter(({ type }) => type === 'file')
      .map(({ path: filePath }) => filePath),
  ].filter(Boolean));
  if (!commitExists(root, evidence.integrationBaseCommit)) {
    append(issues, 'delivery-evidence/integration-base-missing', '交付证据的集成基线提交不存在', contractPath);
  }
  if (!commitExists(root, evidence.subjectCommit)) {
    append(issues, 'delivery-evidence/subject-missing', '交付证据的代码提交不存在', contractPath);
    return;
  }
  if (!isAncestorCommit(root, evidence.integrationBaseCommit, evidence.subjectCommit)) {
    append(issues, 'delivery-evidence/integration-base-not-ancestor', '集成基线不是被验收代码提交的祖先', contractPath);
  }
  if (!isAncestorCommit(root, evidence.subjectCommit, 'HEAD')) {
    append(issues, 'delivery-evidence/subject-not-ancestor', '被验收代码提交不是当前 HEAD 的祖先', contractPath);
    return;
  }
  const laterChanges = collectContractRevisionChanges(root, evidence.subjectCommit, 'HEAD');
  for (const change of laterChanges) {
    const changedPaths = [change.oldPath, change.path].filter(Boolean);
    if (changedPaths.some((filePath) => !allowedMetadataPaths.has(filePath))) {
      append(
        issues,
        'delivery-evidence/code-after-acceptance',
        `人工验收绑定提交之后仍修改了非合同或证据批次文件：${changedPaths.join(' → ')}`,
        changedPaths.at(-1),
      );
    }
  }
}

function validateSubjectDefinition(root, inspection, evidence, issues) {
  const contractPath = inspection.selected.path;
  const loader = createDeliveryContractRevisionLoader({
    root,
    revision: evidence.subjectCommit,
    config: inspection.config,
  });
  const bundle = loadDeliveryContractBundle(loader, contractPath);
  if (!bundle.parsed?.data || bundle.errors.length > 0) {
    append(
      issues,
      'delivery-evidence/subject-contract-missing',
      `被验收代码提交中的合同包不存在或无法解析：${bundle.errors.join('；')}`,
      contractPath,
    );
    return;
  }
  const schema = inspectContractSchema(bundle.parsed, inspection.config);
  if (schema.issues.length > 0) {
    append(
      issues,
      'delivery-evidence/subject-contract-invalid',
      `被验收代码提交中的合同定义不合法：${schema.issues.map(({ message }) => message).join('；')}`,
      contractPath,
    );
    return;
  }
  const artifactDigests = schema.artifacts.flatMap((artifact) => {
    if (!loader.trackedFiles.has(artifact.path)) return [];
    try {
      return [{
        ...artifact,
        digest: sha256Digest(loader.readBuffer(artifact.path)),
      }];
    } catch {
      return [];
    }
  });
  const subjectDigest = calculateDefinitionDigest(bundle.parsed, artifactDigests);
  if (subjectDigest !== inspection.definitionDigest) {
    append(
      issues,
      'delivery-evidence/definition-after-subject',
      '被验收代码提交之后修改了合同定义；必须重新形成代码提交并重新验收',
      contractPath,
    );
  }
}

function validateObligations(
  inspection,
  evidence,
  technicalDigest,
  issues,
  { evidenceRun, priorResults, requireCurrentGateResults },
) {
  const currentResults = new Map(priorResults.map((result) => [result.gateId, result]));
  for (const item of inspection.selected.parsed.obligations) {
    if (!item.checked) {
      append(issues, 'delivery-evidence/unchecked-obligation', `必需事项尚未完成：${item.id}`, inspection.selected.path);
      continue;
    }
    const actor = item.details['执行者'];
    if (actor === 'human') {
      if (!validEvidence(item.details['确认人'])) {
        append(issues, 'delivery-evidence/human-confirmation', `${item.id} 缺少人工确认人`, inspection.selected.path);
      }
      if (!ISO_TIMEZONE.test(item.details['确认时间'] ?? '')) {
        append(issues, 'delivery-evidence/human-confirmation', `${item.id} 缺少有效人工确认时间`, inspection.selected.path);
      }
      if (item.details['绑定定义指纹'] !== evidence.definitionDigest) {
        append(issues, 'delivery-evidence/human-definition-binding', `${item.id} 未绑定当前定义指纹`, inspection.selected.path);
      }
      if (item.id.startsWith('HUMAN-ACCEPT-')) {
        if (item.details['绑定提交'] !== evidence.subjectCommit) {
          append(issues, 'delivery-evidence/human-commit-binding', `${item.id} 未绑定当前代码提交`, inspection.selected.path);
        }
        if (item.details['技术证据指纹'] !== technicalDigest) {
          append(issues, 'delivery-evidence/human-technical-binding', `${item.id} 未绑定当前技术证据指纹`, inspection.selected.path);
        }
      }
    } else {
      const records = resolvedEvidence(
        item.details['证据'],
        evidenceRun,
        issues,
        item.id,
        inspection.selected.path,
      );
      if (actor === 'gate' && records.some(({ type }) => type !== 'gate-result')) {
        append(issues, 'delivery-evidence/gate-evidence-type', `${item.id} 必须引用 gate-result 类型证据`, inspection.selected.path);
      }
      if (actor === 'gate' && records.some(({ gateId }) => gateId !== item.details['门禁'])) {
        append(issues, 'delivery-evidence/gate-evidence-binding', `${item.id} 的证据必须绑定声明的门禁 ${item.details['门禁']}`, inspection.selected.path);
      }
    }
    if (actor === 'gate' && requireCurrentGateResults) {
      const gateId = item.details['门禁'];
      const gateResult = currentResults.get(gateId);
      if (!validEvidence(gateId)) {
        append(issues, 'delivery-evidence/gate-id-missing', `${item.id} 缺少“门禁”字段`, inspection.selected.path);
      } else if (!gateResult || gateResult.status !== 'passed') {
        append(issues, 'delivery-evidence/gate-result-missing', `${item.id} 引用的 ${gateId} 未在本轮获得 passed`, inspection.selected.path);
      } else {
        const recorded = evidenceRun?.gateResults.get(gateId);
        const currentDigest = calculateGateResultDigest(gateResult);
        if (!recorded || recorded.resultDigest !== currentDigest) {
          append(
            issues,
            'delivery-evidence/gate-result-changed',
            `${item.id} 的本轮 ${gateId} GateResult 与已确认技术证据不一致；当前指纹为 ${currentDigest}`,
            inspection.selected.path,
          );
        }
      }
    }
  }
}

function findingEvidence(finding, token, evidenceRun, issues, contractPath) {
  const item = finding.checklist.find(({ id }) => id.includes(token));
  if (!item) return { item: null, records: [] };
  return {
    item,
    records: resolvedEvidence(
      item.details['证据'],
      evidenceRun,
      issues,
      `${finding.id} 的 ${item.id}`,
      contractPath,
    ),
  };
}

function validateRegressionProof(finding, evidence, evidenceRun, issues, contractPath) {
  const red = findingEvidence(finding, 'RED-TEST', evidenceRun, issues, contractPath);
  const green = findingEvidence(finding, 'GREEN-TEST', evidenceRun, issues, contractPath);
  if (
    !red.item
    || !green.item
    || !validEvidence(red.item.details['测试'])
    || red.item.details['测试'] !== green.item.details['测试']
  ) {
    append(issues, 'delivery-evidence/red-green-test', `${finding.id} 的红—绿证明必须引用同一个回归测试`, contractPath);
    return;
  }
  if (red.item.details['绑定提交'] !== finding.details['问题版本']) {
    append(issues, 'delivery-evidence/red-commit', `${finding.id} 的失败测试未绑定问题版本`, contractPath);
  }
  if (green.item.details['绑定提交'] !== evidence.subjectCommit) {
    append(issues, 'delivery-evidence/green-commit', `${finding.id} 的通过测试未绑定最终代码提交`, contractPath);
  }
  const redExecution = red.records.find(({ type }) => type === 'execution');
  const greenExecution = green.records.find(({ type }) => type === 'execution');
  const redRun = redExecution && evidenceRun?.executions.get(redExecution.executionId);
  const greenRun = greenExecution && evidenceRun?.executions.get(greenExecution.executionId);
  if (!redRun || redRun.exitCode === 0 || redRun.subjectCommit !== finding.details['问题版本']) {
    append(issues, 'delivery-evidence/red-run', `${finding.id} 的失败证据必须引用问题版本上退出码非零的执行日志`, contractPath);
  }
  if (!greenRun || greenRun.exitCode !== 0 || greenRun.subjectCommit !== evidence.subjectCommit) {
    append(issues, 'delivery-evidence/green-run', `${finding.id} 的通过证据必须引用最终代码上退出码为零的执行日志`, contractPath);
  }
}

function validateFindings(inspection, evidence, evidenceRun, issues) {
  const contractPath = inspection.selected.path;
  for (const finding of inspection.selected.parsed.findings) {
    if (!commitExists(inspection.root, finding.details['问题版本'])) {
      append(issues, 'delivery-evidence/finding-commit-missing', `${finding.id} 的问题版本提交不存在`, contractPath);
    }
    if (
      finding.details['测试环境部署提交']
      && !commitExists(inspection.root, finding.details['测试环境部署提交'])
    ) {
      append(issues, 'delivery-evidence/test-deployment-missing', `${finding.id} 的测试环境部署提交不存在`, contractPath);
    }
    if (!['closed', 'rejected', 'deferred'].includes(finding.details['当前状态'])) {
      append(issues, 'delivery-evidence/open-finding', `交付发现尚未关闭：${finding.id}`, inspection.selected.path);
    }
    for (const item of finding.checklist) {
      if (!item.checked) {
        append(issues, 'delivery-evidence/finding-unchecked', `${finding.id} 的处理事项尚未完成：${item.id}`, inspection.selected.path);
      }
      if (['REGISTER', 'INVESTIGATE', 'REPRODUCE', 'RED-TEST', 'FIX', 'GREEN-TEST', 'VERIFY']
        .some((token) => item.id.includes(token))) {
        resolvedEvidence(
          item.details['证据'],
          evidenceRun,
          issues,
          `${finding.id} 的 ${item.id}`,
          contractPath,
        );
      }
    }
    if (finding.details['类型'] === 'implementation-gap'
      && !['rejected', 'deferred'].includes(finding.details['当前状态'])) {
      validateRegressionProof(finding, evidence, evidenceRun, issues, contractPath);
    }
    if (['test-environment', 'human-acceptance'].includes(finding.details['发现阶段'])
      && finding.details['当前状态'] === 'closed') {
      const retest = finding.checklist.find(({ id }) => id.includes('HUMAN-RETEST'));
      if (!retest?.checked || retest.details['测试环境部署提交'] !== evidence.subjectCommit) {
        append(issues, 'delivery-evidence/human-retest-binding', `${finding.id} 的人工复测必须绑定最终代码提交`, contractPath);
      }
    }
  }
}

function validateRegressionCoverage(inspection, evidenceRun, issues) {
  for (const affected of inspection.selected.parsed.data.regressionCoverage?.affectedContracts ?? []) {
    for (const verification of affected.verification) {
      if (verification.result !== 'passed') continue;
      resolvedEvidence(
        verification.evidence,
        evidenceRun,
        issues,
        `合同 ${affected.contractId} 的回归验证 ${verification.test}`,
        inspection.selected.path,
      );
    }
  }
}

function derivedState(inspection) {
  const items = inspection.selected.parsed.obligations;
  const technical = items.filter(({ details }) => details['执行者'] !== 'human');
  const acceptance = items.find(({ id }) => id.startsWith('HUMAN-ACCEPT-'));
  if (technical.some(({ checked }) => !checked)) return 'boundary-valid';
  if (!acceptance?.checked) return 'acceptance-ready';
  return 'accepted';
}

export function inspectDeliveryEvidence({
  root,
  inspection,
  priorResults = [],
  requireCurrentGateResults = false,
}) {
  const issues = [];
  if (!inspection.enabled || !inspection.selected || inspection.issues.length > 0) {
    return { issues, state: 'specified' };
  }
  const parsed = inspection.selected.parsed;
  const evidence = parsed.data.deliveryEvidence;
  if (!validateEvidenceShape(evidence, issues, inspection.selected.path)) {
    return { issues, state: derivedState(inspection) };
  }
  if (evidence.definitionDigest !== inspection.definitionDigest) {
    append(issues, 'delivery-evidence/definition-digest-mismatch', '交付证据未绑定当前合同定义指纹', inspection.selected.path);
  }
  if (evidence.sourceBundleDigest !== inspection.sourceBundleDigest) {
    append(issues, 'delivery-evidence/source-digest-mismatch', '交付证据未绑定当前需求来源整批指纹', inspection.selected.path);
  }
  const evidenceRun = inspectEvidenceRun({ evidence, inspection, issues });
  validateCommitBinding(root, inspection, evidence, evidenceRun, issues);
  if (commitExists(root, evidence.subjectCommit)) {
    validateSubjectDefinition(root, inspection, evidence, issues);
  }
  const technicalEvidenceDigest = calculateTechnicalEvidenceDigest(parsed, evidence, evidenceRun);
  validateObligations(inspection, evidence, technicalEvidenceDigest, issues, {
    evidenceRun,
    priorResults,
    requireCurrentGateResults,
  });
  validateFindings(inspection, evidence, evidenceRun, issues);
  validateRegressionCoverage(inspection, evidenceRun, issues);
  if (evidence.technicalEvidenceDigest !== technicalEvidenceDigest) {
    append(
      issues,
      'delivery-evidence/technical-digest-mismatch',
      `技术证据指纹不一致；当前计算值为 ${technicalEvidenceDigest}`,
      inspection.selected.path,
    );
  }
  const executionDigest = calculateExecutionDigest(parsed, evidence);
  if (evidence.executionDigest !== executionDigest) {
    append(
      issues,
      'delivery-evidence/execution-digest-mismatch',
      `执行状态指纹不一致；当前计算值为 ${executionDigest}`,
      inspection.selected.path,
    );
  }
  if (!trackedTreeIsClean(root)) {
    append(issues, 'delivery-evidence/dirty-tree', '发布就绪检查要求已跟踪文件的工作区保持干净', inspection.selected.path);
  }
  return {
    executionDigest,
    issues,
    state: issues.length === 0 ? 'release-ready' : derivedState(inspection),
    technicalEvidenceDigest,
  };
}
