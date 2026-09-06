import path from 'node:path';
import { normalizeGitPath } from '../../config/path-matching.js';

const CONTRACT_TYPES = new Set(['feature', 'enhancement', 'repair', 'refactor', 'maintenance']);
const ARTIFACT_MODES = new Set(['inline', 'file', 'reference', 'not-needed']);
const ARTIFACT_NAMES = Object.freeze(['spec', 'design', 'tasks', 'examples', 'visuals']);
const WORKTREE_POLICIES = new Set(['any', 'preferred', 'required']);
const COORDINATION_RISKS = new Set([
  'file-overlap', 'line-overlap', 'symbol-overlap', 'behavior-overlap',
]);
const COORDINATION_STRATEGIES = new Set([
  'coexist', 'integrate-after', 'extract-foundation', 'consolidate', 'cancel',
]);
const COORDINATION_STATES = new Set(['pending', 'confirmed', 'conflicted', 'resolved']);
const ID = /^[A-Za-z][A-Za-z0-9._-]*$/;
const FACT_ID = /^(?:REQ|INV|AC)-[A-Z0-9-]+$/;
const FINDING_ID = /^FND-[A-Z0-9-]+$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ISO_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function problem(issues, message) {
  issues.push({ rule: 'delivery-contract/schema', message });
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label, issues) {
  if (!object(value)) {
    problem(issues, `${label} 必须是对象`);
    return false;
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) problem(issues, `${label} 包含不支持的字段：${unknown.join(', ')}`);
  return true;
}

function nonEmptyText(value, label, issues) {
  if (typeof value !== 'string' || value.trim() === '') {
    problem(issues, `${label} 必须是非空字符串`);
    return false;
  }
  return true;
}

function branchName(value, label, issues) {
  if (!nonEmptyText(value, label, issues)) return;
  if (
    value.startsWith('-')
    || value.startsWith('.')
    || value.endsWith('.')
    || value.endsWith('/')
    || value.endsWith('.lock')
    || value.includes('..')
    || value.includes('@{')
    || value.includes('//')
    || [...value].some((character) => character.codePointAt(0) <= 0x20)
    || /[~^:?*[\\]/.test(value)
  ) {
    problem(issues, `${label} 不是合法且稳定的 Git 分支名称`);
  }
}

function contractStringArray(value, label, issues, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    problem(issues, `${label} 必须是${allowEmpty ? '' : '非空'}数组`);
    return [];
  }
  if (value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    problem(issues, `${label} 只能包含非空字符串`);
    return [];
  }
  if (new Set(value).size !== value.length) problem(issues, `${label} 不得包含重复值`);
  return value;
}

function safePath(value, label, issues) {
  if (!nonEmptyText(value, label, issues)) return null;
  const normalized = normalizeGitPath(value.trim());
  if (
    path.isAbsolute(value)
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.startsWith('!')
    || normalized.split('/').includes('..')
  ) {
    problem(issues, `${label} 必须是仓库内相对路径，且不得包含否定规则或 ..`);
    return null;
  }
  return normalized;
}

function validateConfirmation(value, label, issues, { requireDigest = false } = {}) {
  if (!exactKeys(
    value,
    [
      'status', 'confirmedAt', 'confirmedBy', 'comment', 'definitionDigest',
      'sourceBundleDigest', 'revision',
    ],
    label,
    issues,
  )) return;
  if (value.status !== 'confirmed') problem(issues, `${label}.status 必须为 confirmed`);
  if (!nonEmptyText(value.confirmedBy, `${label}.confirmedBy`, issues)) return;
  if (typeof value.confirmedAt !== 'string' || !ISO_TIMEZONE.test(value.confirmedAt)) {
    problem(issues, `${label}.confirmedAt 必须是带时区的 ISO 8601 时间`);
  }
  if (requireDigest && !DIGEST.test(value.definitionDigest ?? '')) {
    problem(issues, `${label}.definitionDigest 必须是 sha256 指纹`);
  }
}

function validateRepository(value, issues) {
  if (!exactKeys(
    value,
    ['workingBranch', 'targetBranch', 'baselineCommit', 'changeBoundary', 'worktree'],
    'repository',
    issues,
  )) return;
  branchName(value.workingBranch, 'repository.workingBranch', issues);
  branchName(value.targetBranch, 'repository.targetBranch', issues);
  if (!COMMIT.test(value.baselineCommit ?? '')) {
    problem(issues, 'repository.baselineCommit 必须是完整的 40 位 Git 提交哈希');
  }
  if (exactKeys(
    value.changeBoundary,
    ['allowedPaths', 'forbiddenPaths'],
    'repository.changeBoundary',
    issues,
  )) {
    const allowed = contractStringArray(
      value.changeBoundary.allowedPaths,
      'repository.changeBoundary.allowedPaths',
      issues,
      { allowEmpty: true },
    );
    const forbidden = contractStringArray(
      value.changeBoundary.forbiddenPaths,
      'repository.changeBoundary.forbiddenPaths',
      issues,
      { allowEmpty: true },
    );
    [...allowed, ...forbidden].forEach((pattern, index) => {
      safePath(pattern, `repository.changeBoundary 路径规则 ${index + 1}`, issues);
    });
  }
  if (exactKeys(value.worktree, ['policy'], 'repository.worktree', issues)
    && !WORKTREE_POLICIES.has(value.worktree.policy)) {
    problem(issues, 'repository.worktree.policy 必须为 any、preferred 或 required');
  }
}

function timestampToken(confirmedAt) {
  return typeof confirmedAt === 'string'
    ? confirmedAt.replace(/[-:]/g, '').replace(/\.\d+(?=Z|[+-])/, '')
    : '';
}

function resolveContractPath(value, contractRoot, label, issues) {
  const normalized = safePath(value, label, issues);
  if (!normalized) return null;
  return normalized.startsWith(`${contractRoot}/`) ? normalized : `${contractRoot}/${normalized}`;
}

function validateRequirements(value, contractRoot, issues) {
  const files = [];
  const facts = [];
  if (!exactKeys(
    value,
    ['revision', 'confirmation', 'sources', 'sourceBundleDigest', 'facts', 'blockingQuestions'],
    'requirements',
    issues,
  )) return { facts, files };
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    problem(issues, 'requirements.revision 必须是正整数');
  }
  validateConfirmation(value.confirmation, 'requirements.confirmation', issues);
  if (value.confirmation?.revision !== value.revision) {
    problem(issues, 'requirements.confirmation.revision 必须绑定当前 requirements.revision');
  }
  if (!DIGEST.test(value.sourceBundleDigest ?? '')) {
    problem(issues, 'requirements.sourceBundleDigest 必须是 sha256 指纹');
  }
  if (!Array.isArray(value.blockingQuestions) || value.blockingQuestions.length > 0) {
    problem(issues, 'requirements.blockingQuestions 必须是空数组，存在阻塞问题时不能确认合同');
  }
  const sourceIds = new Set();
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    problem(issues, 'requirements.sources 必须至少登记一个本地需求来源');
  } else {
    for (const [sourceIndex, source] of value.sources.entries()) {
      const label = `requirements.sources[${sourceIndex}]`;
      if (!exactKeys(
        source,
        ['id', 'name', 'acquisition', 'capturedBy', 'originalUrl', 'coverage', 'files'],
        label,
        issues,
      )) continue;
      if (!nonEmptyText(source.id, `${label}.id`, issues)) continue;
      if (sourceIds.has(source.id)) problem(issues, `需求来源 id 重复：${source.id}`);
      sourceIds.add(source.id);
      nonEmptyText(source.name, `${label}.name`, issues);
      if (!['download', 'screenshot'].includes(source.acquisition)) {
        problem(issues, `${label}.acquisition 必须为 download 或 screenshot`);
      }
      if (source.acquisition === 'screenshot') {
        nonEmptyText(source.capturedBy, `${label}.capturedBy`, issues);
        nonEmptyText(source.coverage, `${label}.coverage`, issues);
      } else {
        if (source.capturedBy != null) nonEmptyText(source.capturedBy, `${label}.capturedBy`, issues);
        if (source.coverage != null) nonEmptyText(source.coverage, `${label}.coverage`, issues);
      }
      if (source.originalUrl != null && !nonEmptyText(source.originalUrl, `${label}.originalUrl`, issues)) continue;
      if (!Array.isArray(source.files) || source.files.length === 0) {
        problem(issues, `${label}.files 必须至少包含一个本地文件`);
        continue;
      }
      const pageNumbers = [];
      const sequences = [];
      for (const [fileIndex, file] of source.files.entries()) {
        const fileLabel = `${label}.files[${fileIndex}]`;
        if (!exactKeys(
          file,
          ['path', 'sequence', 'mediaType', 'digestAlgorithm', 'digest'],
          fileLabel,
          issues,
        )) continue;
        if (file.sequence != null) {
          if (!Number.isInteger(file.sequence) || file.sequence < 1) {
            problem(issues, `${fileLabel}.sequence 必须是正整数`);
          } else {
            sequences.push(file.sequence);
          }
        } else if (source.files.length > 1) {
          problem(issues, `${fileLabel}.sequence 在同一来源包含多个文件时必填`);
        }
        const filePath = resolveContractPath(file.path, contractRoot, `${fileLabel}.path`, issues);
        if (filePath) {
          const expectedRoot = `${contractRoot}/requirements/rev-${String(value.revision).padStart(3, '0')}/sources/`;
          if (!filePath.startsWith(expectedRoot)) {
            problem(issues, `${fileLabel}.path 必须位于 ${expectedRoot}`);
          }
          const token = timestampToken(value.confirmation?.confirmedAt);
          if (token && !path.posix.basename(filePath).includes(`__${token}__`)) {
            problem(issues, `${fileLabel}.path 文件名必须包含需求确认时间 ${token}`);
          }
          const page = path.posix.basename(filePath).match(/__page-(\d{3})\./)?.[1];
          if (page) {
            pageNumbers.push(Number(page));
            if (file.sequence != null && Number(page) !== file.sequence) {
              problem(issues, `${fileLabel}.sequence 必须与文件名中的 page-${page} 一致`);
            }
          }
        }
        nonEmptyText(file.mediaType, `${fileLabel}.mediaType`, issues);
        if (file.digestAlgorithm !== 'sha256-bytes-v1') {
          problem(issues, `${fileLabel}.digestAlgorithm 必须为 sha256-bytes-v1`);
        }
        if (!DIGEST.test(file.digest ?? '')) problem(issues, `${fileLabel}.digest 必须是 sha256 指纹`);
        if (filePath) files.push({ ...file, path: filePath, sourceId: source.id });
      }
      if (pageNumbers.length > 0) {
        const expected = pageNumbers.map((_, index) => index + 1);
        const actual = [...pageNumbers].sort((left, right) => left - right);
        if (actual.some((entry, index) => entry !== expected[index])) {
          problem(issues, `${label} 的连续截图页码必须从 page-001 开始且不能跳号`);
        }
      }
      if (sequences.length > 0) {
        const actual = [...sequences].sort((left, right) => left - right);
        const expected = actual.map((_, index) => index + 1);
        if (actual.some((entry, index) => entry !== expected[index])) {
          problem(issues, `${label} 的文件 sequence 必须从 1 开始、唯一且连续`);
        }
      }
    }
  }
  const factIds = new Set();
  if (!Array.isArray(value.facts) || value.facts.length === 0) {
    problem(issues, 'requirements.facts 必须至少包含一条经过确认的需求事实');
  } else {
    for (const [index, fact] of value.facts.entries()) {
      const label = `requirements.facts[${index}]`;
      if (!exactKeys(fact, ['id', 'summary', 'sourceId', 'locator'], label, issues)) continue;
      if (!FACT_ID.test(fact.id ?? '')) problem(issues, `${label}.id 必须以 REQ-、INV- 或 AC- 开头`);
      if (factIds.has(fact.id)) problem(issues, `需求事实 id 重复：${fact.id}`);
      factIds.add(fact.id);
      nonEmptyText(fact.summary, `${label}.summary`, issues);
      if (!sourceIds.has(fact.sourceId)) problem(issues, `${label}.sourceId 未引用已登记来源`);
      nonEmptyText(fact.locator, `${label}.locator`, issues);
      facts.push(fact);
    }
  }
  if (value.confirmation?.sourceBundleDigest !== value.sourceBundleDigest) {
    problem(issues, 'requirements.confirmation.sourceBundleDigest 必须绑定当前 sourceBundleDigest');
  }
  return { facts, files };
}

function validateArtifactPlan(value, contractRoot, issues) {
  const artifacts = [];
  if (!exactKeys(value, ['generatedBy', 'generatedAt', 'items', 'confirmation'], 'artifactPlan', issues)) {
    return artifacts;
  }
  if (value.generatedBy !== 'ai') problem(issues, 'artifactPlan.generatedBy 必须为 ai');
  if (typeof value.generatedAt !== 'string' || !ISO_TIMEZONE.test(value.generatedAt)) {
    problem(issues, 'artifactPlan.generatedAt 必须是带时区的 ISO 8601 时间');
  }
  validateConfirmation(value.confirmation, 'artifactPlan.confirmation', issues);
  if (!exactKeys(value.items, ARTIFACT_NAMES, 'artifactPlan.items', issues)) return artifacts;
  for (const name of ARTIFACT_NAMES) {
    const item = value.items?.[name];
    const label = `artifactPlan.items.${name}`;
    if (!exactKeys(item, ['mode', 'paths', 'reason'], label, issues)) continue;
    if (!ARTIFACT_MODES.has(item.mode)) problem(issues, `${label}.mode 不受支持`);
    const paths = contractStringArray(item.paths, `${label}.paths`, issues, { allowEmpty: true });
    nonEmptyText(item.reason, `${label}.reason`, issues);
    if (['file', 'reference'].includes(item.mode) && paths.length === 0) {
      problem(issues, `${label} 使用 ${item.mode} 时必须登记至少一个路径`);
    }
    if (['inline', 'not-needed'].includes(item.mode) && paths.length > 0) {
      problem(issues, `${label} 使用 ${item.mode} 时 paths 必须为空数组`);
    }
    for (const [index, artifactPath] of paths.entries()) {
      const resolved = item.mode === 'file'
        ? resolveContractPath(artifactPath, contractRoot, `${label}.paths[${index}]`, issues)
        : safePath(artifactPath, `${label}.paths[${index}]`, issues);
      if (resolved) {
        if (item.mode === 'file' && !resolved.startsWith(`${contractRoot}/`)) {
          problem(issues, `${label}.paths[${index}] 必须位于当前合同目录`);
        }
        artifacts.push({ kind: name, mode: item.mode, path: resolved });
      }
    }
  }
  return artifacts;
}

function validateMaterials(value, contractRoot, requirementsRevision, issues) {
  if (!exactKeys(
    value,
    ['requirements', 'traceability', 'obligations', 'findingsDirectory'],
    'materials',
    issues,
  )) return;
  const resolved = Object.fromEntries(
    Object.entries(value).map(([name, materialPath]) => [
      name,
      resolveContractPath(materialPath, contractRoot, `materials.${name}`, issues),
    ]),
  );
  for (const name of ['requirements', 'traceability', 'obligations']) {
    if (resolved[name] && !resolved[name].endsWith('.md')) {
      problem(issues, `materials.${name} 必须引用 Markdown 文件`);
    }
  }
  const expectedRequirements = `${contractRoot}/requirements/rev-${String(requirementsRevision).padStart(3, '0')}/requirements.md`;
  if (resolved.requirements && resolved.requirements !== expectedRequirements) {
    problem(issues, `materials.requirements 必须引用当前需求修订 ${expectedRequirements}`);
  }
  if (resolved.findingsDirectory?.endsWith('.md')) {
    problem(issues, 'materials.findingsDirectory 必须引用目录而不是 Markdown 文件');
  }
}

function validateTraceability(value, facts, issues) {
  if (!Array.isArray(value) || value.length === 0) {
    problem(issues, 'traceability 必须至少包含一条需求到任务和验证的追踪关系');
    return;
  }
  const factIds = new Set(facts.map(({ id }) => id));
  const traced = new Set();
  for (const [index, item] of value.entries()) {
    const label = `traceability[${index}]`;
    if (!exactKeys(item, ['factId', 'design', 'tasks', 'artifacts', 'verification'], label, issues)) continue;
    if (!factIds.has(item.factId)) problem(issues, `${label}.factId 未引用已确认需求事实`);
    if (traced.has(item.factId)) problem(issues, `${label}.factId 重复`);
    traced.add(item.factId);
    contractStringArray(item.design, `${label}.design`, issues, { allowEmpty: true });
    contractStringArray(item.artifacts, `${label}.artifacts`, issues, { allowEmpty: true });
    contractStringArray(item.tasks, `${label}.tasks`, issues);
    contractStringArray(item.verification, `${label}.verification`, issues);
  }
  for (const factId of factIds) {
    if (!traced.has(factId)) problem(issues, `需求事实 ${factId} 缺少追踪关系`);
  }
}

function validateRelations(value, issues) {
  if (value == null) return;
  if (!exactKeys(value, ['follows', 'repairs', 'dependsOn'], 'relations', issues)) return;
  for (const [name, entries] of Object.entries(value)) {
    contractStringArray(entries, `relations.${name}`, issues, { allowEmpty: true });
  }
}

function validatePlannedChanges(value, issues) {
  if (value == null) return;
  if (!exactKeys(value, ['paths'], 'plannedChanges', issues)) return;
  const paths = contractStringArray(value.paths, 'plannedChanges.paths', issues, {
    allowEmpty: true,
  });
  paths.forEach((entry, index) => safePath(
    entry,
    `plannedChanges.paths[${index}]`,
    issues,
  ));
}

function validateCoordinationConfirmation(value, label, issues) {
  if (!COORDINATION_STATES.has(value.status)) {
    problem(issues, `${label}.status 必须为 pending、confirmed、conflicted 或 resolved`);
    return;
  }
  if (['confirmed', 'resolved'].includes(value.status)) {
    nonEmptyText(value.confirmedBy, `${label}.confirmedBy`, issues);
    if (typeof value.confirmedAt !== 'string' || !ISO_TIMEZONE.test(value.confirmedAt)) {
      problem(issues, `${label}.confirmedAt 必须是带时区的 ISO 8601 时间`);
    }
  }
}

function validateCoordination(value, issues) {
  if (value == null) return;
  if (!exactKeys(value, ['overlaps', 'dependencies'], 'coordination', issues)) return;
  if (!Array.isArray(value.overlaps)) {
    problem(issues, 'coordination.overlaps 必须是数组');
  } else {
    const ids = new Set();
    value.overlaps.forEach((overlap, index) => {
      const label = `coordination.overlaps[${index}]`;
      if (!exactKeys(
        overlap,
        [
          'withContractId', 'paths', 'risk', 'strategy', 'status', 'reason',
          'confirmedAt', 'confirmedBy',
        ],
        label,
        issues,
      )) return;
      if (!ID.test(overlap.withContractId ?? '')) {
        problem(issues, `${label}.withContractId 必须是稳定合同标识`);
      } else if (ids.has(overlap.withContractId)) {
        problem(issues, `${label}.withContractId 不得重复`);
      } else {
        ids.add(overlap.withContractId);
      }
      const paths = contractStringArray(overlap.paths, `${label}.paths`, issues);
      paths.forEach((entry, pathIndex) => safePath(
        entry,
        `${label}.paths[${pathIndex}]`,
        issues,
      ));
      if (!COORDINATION_RISKS.has(overlap.risk)) {
        problem(issues, `${label}.risk 不受支持`);
      }
      if (!COORDINATION_STRATEGIES.has(overlap.strategy)) {
        problem(issues, `${label}.strategy 不受支持`);
      }
      nonEmptyText(overlap.reason, `${label}.reason`, issues);
      validateCoordinationConfirmation(overlap, label, issues);
    });
  }
  if (!Array.isArray(value.dependencies)) {
    problem(issues, 'coordination.dependencies 必须是数组');
  } else {
    const ids = new Set();
    value.dependencies.forEach((dependency, index) => {
      const label = `coordination.dependencies[${index}]`;
      if (!exactKeys(
        dependency,
        ['contractId', 'relation', 'requiredLandedCommit'],
        label,
        issues,
      )) return;
      if (!ID.test(dependency.contractId ?? '')) {
        problem(issues, `${label}.contractId 必须是稳定合同标识`);
      } else if (ids.has(dependency.contractId)) {
        problem(issues, `${label}.contractId 不得重复`);
      } else {
        ids.add(dependency.contractId);
      }
      if (!['integrate-after', 'depends-on', 'foundation'].includes(dependency.relation)) {
        problem(issues, `${label}.relation 必须为 integrate-after、depends-on 或 foundation`);
      }
      if (dependency.requiredLandedCommit != null
        && !COMMIT.test(dependency.requiredLandedCommit)) {
        problem(issues, `${label}.requiredLandedCommit 必须为 null 或完整 Git 提交哈希`);
      }
    });
  }
}

function validateRegressionCoverage(value, issues) {
  if (value == null) return;
  if (!exactKeys(value, ['affectedContracts'], 'regressionCoverage', issues)) return;
  if (!Array.isArray(value.affectedContracts)) {
    problem(issues, 'regressionCoverage.affectedContracts 必须是数组');
    return;
  }
  const ids = new Set();
  value.affectedContracts.forEach((affected, index) => {
    const label = `regressionCoverage.affectedContracts[${index}]`;
    if (!exactKeys(affected, ['contractId', 'reason', 'verification'], label, issues)) return;
    if (!ID.test(affected.contractId ?? '')) {
      problem(issues, `${label}.contractId 必须是稳定合同标识`);
    } else if (ids.has(affected.contractId)) {
      problem(issues, `${label}.contractId 不得重复`);
    } else {
      ids.add(affected.contractId);
    }
    nonEmptyText(affected.reason, `${label}.reason`, issues);
    if (!Array.isArray(affected.verification) || affected.verification.length === 0) {
      problem(issues, `${label}.verification 必须是非空数组`);
      return;
    }
    affected.verification.forEach((verification, verificationIndex) => {
      const verificationLabel = `${label}.verification[${verificationIndex}]`;
      if (!exactKeys(
        verification,
        ['test', 'result', 'evidence'],
        verificationLabel,
        issues,
      )) return;
      nonEmptyText(verification.test, `${verificationLabel}.test`, issues);
      if (!['pending', 'passed', 'failed'].includes(verification.result)) {
        problem(issues, `${verificationLabel}.result 必须为 pending、passed 或 failed`);
      }
      if (verification.evidence != null) {
        nonEmptyText(verification.evidence, `${verificationLabel}.evidence`, issues);
      }
    });
  });
}

function validateHistoricalFeedback(value, issues) {
  if (!Array.isArray(value)) {
    problem(issues, 'historicalFeedbackApplied 必须是数组');
    return;
  }
  const identities = new Set();
  value.forEach((entry, index) => {
    const label = `historicalFeedbackApplied[${index}]`;
    if (!exactKeys(
      entry,
      ['findingId', 'sourceContractId', 'recurrenceKey', 'appliedAs', 'reason'],
      label,
      issues,
    )) return;
    if (!FINDING_ID.test(entry.findingId ?? '')) {
      problem(issues, `${label}.findingId 必须以 FND- 开头`);
    }
    if (!ID.test(entry.sourceContractId ?? '')) {
      problem(issues, `${label}.sourceContractId 必须是稳定合同标识`);
    }
    const identity = `${entry.sourceContractId}\0${entry.findingId}`;
    if (identities.has(identity)) problem(issues, `${label} 重复登记同一历史交付发现`);
    identities.add(identity);
    nonEmptyText(entry.recurrenceKey, `${label}.recurrenceKey`, issues);
    contractStringArray(entry.appliedAs, `${label}.appliedAs`, issues);
    nonEmptyText(entry.reason, `${label}.reason`, issues);
  });
}

export function inspectContractSchema(input, config) {
  const issues = [];
  const parsed = input?.data && input?.mainData ? input : null;
  const data = parsed?.data ?? input;
  const mainData = parsed?.mainData ?? input;
  const allowedKeys = [
    'schemaVersion', 'contractId', 'contractRevision', 'featureId', 'type', 'lifecycle',
    'summary', 'relations', 'plannedChanges', 'coordination', 'regressionCoverage',
    'historicalFeedbackApplied',
    'repository', 'materials', 'artifactPlan', 'confirmation',
    'deliveryEvidence',
  ];
  if (!exactKeys(mainData, allowedKeys, '交付合同主文件', issues)) {
    return { artifacts: [], facts: [], issues, requirementFiles: [] };
  }
  for (const field of [
    'schemaVersion', 'contractId', 'contractRevision', 'featureId', 'type', 'lifecycle',
    'summary', 'repository', 'materials', 'artifactPlan', 'confirmation',
    'historicalFeedbackApplied',
  ]) {
    if (!Object.hasOwn(mainData, field)) problem(issues, `交付合同主文件缺少必填字段：${field}`);
  }
  if (data.schemaVersion !== 2) problem(issues, 'schemaVersion 必须为 2');
  for (const field of ['contractId', 'featureId']) {
    if (typeof data[field] !== 'string' || !ID.test(data[field])) {
      problem(issues, `${field} 必须是稳定标识`);
    }
  }
  if (!Number.isInteger(data.contractRevision) || data.contractRevision < 1) {
    problem(issues, 'contractRevision 必须是正整数');
  }
  if (!CONTRACT_TYPES.has(data.type)) {
    problem(issues, 'type 必须为 feature、enhancement、repair、refactor 或 maintenance');
  }
  if (!['active', 'closed'].includes(data.lifecycle)) {
    problem(issues, 'lifecycle 必须为 active 或 closed');
  }
  nonEmptyText(data.summary, 'summary', issues);
  validateRelations(data.relations, issues);
  validatePlannedChanges(data.plannedChanges, issues);
  validateCoordination(data.coordination, issues);
  validateRegressionCoverage(data.regressionCoverage, issues);
  validateHistoricalFeedback(data.historicalFeedbackApplied, issues);
  validateRepository(data.repository, issues);
  const contractRoot = `${config.contractsDirectory}/${data.contractId}`;
  const requirements = validateRequirements(data.requirements, contractRoot, issues);
  validateMaterials(data.materials, contractRoot, data.requirements?.revision, issues);
  const requirementPaths = requirements.files.map(({ path: filePath }) => filePath);
  if (new Set(requirementPaths).size !== requirementPaths.length) {
    problem(issues, 'requirements.sources 中的本地文件路径不得重复');
  }
  const artifacts = validateArtifactPlan(data.artifactPlan, contractRoot, issues);
  validateTraceability(data.traceability, requirements.facts, issues);
  validateConfirmation(data.confirmation, 'confirmation', issues, { requireDigest: true });
  return {
    artifacts,
    facts: requirements.facts,
    issues,
    requirementFiles: requirements.files,
  };
}
