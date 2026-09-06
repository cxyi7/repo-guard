import micromatch from 'micromatch';
import {
  calculateArtifactPlanDigest,
  calculateDefinitionDigest,
  calculateRequirementFactsDigest,
  calculateSourceBundleDigest,
  sha256Digest,
} from './digests.js';
import { inspectContractContent } from './contract-content.js';
import { inspectContractSchema } from './contract-schema.js';
import { inspectFeatureRegistry } from './feature-registry.js';
import { loadDeliveryContractBundle } from './contract-bundle.js';
import {
  createDeliveryContractLoader,
  createDeliveryContractRevisionLoader,
} from './loader.js';
import {
  collectContractRevisionChanges,
  commitExists,
  currentHeadCommit,
  inspectWorktree,
  isAncestorCommit,
  listFileRevisionCommits,
  readFileAtRevision,
  resolveBranchCommit,
  resolveDeliveryBranch,
  resolveDeliveryContractId,
} from '../../git/delivery-contract-facts.js';

const MATCH_OPTIONS = Object.freeze({ dot: true, nocase: false });

function matches(filePath, patterns) {
  return patterns.length > 0 && micromatch.isMatch(filePath, patterns, MATCH_OPTIONS);
}

function changePaths(change, { copySourceRequiresAllowed = false } = {}) {
  if (change.status.startsWith('R')) return [change.oldPath, change.path].filter(Boolean);
  if (change.status.startsWith('C')) {
    return copySourceRequiresAllowed
      ? [change.oldPath, change.path].filter(Boolean)
      : [change.path].filter(Boolean);
  }
  return [change.path].filter(Boolean);
}

function triggerPaths(change) {
  return [change.oldPath, change.path].filter(Boolean);
}

function requiredChange(changes, config) {
  return changes.some((change) => triggerPaths(change).some((filePath) => (
    matches(filePath, config.requiredFor) && !matches(filePath, config.exclude)
  )));
}

function appendIssue(issues, item, fallbackPath = null) {
  issues.push({
    rule: item.rule ?? 'delivery-contract/invalid',
    message: item.message,
    path: item.path ?? fallbackPath,
  });
}

function uniqueChanges(changes) {
  const byIdentity = new Map();
  for (const change of changes) {
    byIdentity.set(`${change.status}\0${change.oldPath ?? ''}\0${change.path}`, change);
  }
  return [...byIdentity.values()];
}

function readRegistry(loader, config, issues) {
  if (!loader.trackedFiles.has(config.registryPath)) {
    appendIssue(issues, {
      rule: 'delivery-contract/feature-registry-missing',
      message: `功能登记表未受 Git 跟踪：${config.registryPath}`,
      path: config.registryPath,
    });
    return null;
  }
  try {
    return JSON.parse(loader.readText(config.registryPath));
  } catch (error) {
    appendIssue(issues, {
      rule: 'delivery-contract/feature-registry-invalid-json',
      message: `功能登记表无法解析为 JSON：${error.message}`,
      path: config.registryPath,
    });
    return null;
  }
}

function readContracts(loader, issues) {
  const contracts = [];
  const ids = new Map();
  for (const contractPath of loader.contractPaths) {
    const { errors, parsed, source } = loadDeliveryContractBundle(loader, contractPath);
    errors.forEach((message) => appendIssue(issues, {
      rule: 'delivery-contract/markdown',
      message,
      path: contractPath,
    }));
    if (!parsed?.data) continue;
    const contractId = parsed.data.contractId;
    if (typeof contractId === 'string' && ids.has(contractId)) {
      appendIssue(issues, {
        rule: 'delivery-contract/duplicate-id',
        message: `交付合同 id 重复：${contractId}`,
        path: contractPath,
      });
    } else if (typeof contractId === 'string') {
      ids.set(contractId, contractPath);
    }
    contracts.push({ parsed, path: contractPath, source });
  }
  return contracts;
}

function selectContract(contracts, branch, explicitId, isRequired, issues) {
  const active = contracts.filter(({ parsed }) => parsed.data.lifecycle === 'active');
  const candidates = explicitId
    ? active.filter(({ parsed }) => parsed.data.contractId === explicitId)
    : active.filter(({ parsed }) => parsed.data.repository?.workingBranch === branch);
  if (candidates.length === 0) {
    if (isRequired || explicitId) {
      appendIssue(issues, {
        rule: 'delivery-contract/not-found',
        message: explicitId
          ? `未找到显式指定的活动交付合同：${explicitId}`
          : `当前变更需要交付合同，但分支 ${branch || '<detached>'} 没有唯一活动合同`,
      });
    }
    return null;
  }
  if (candidates.length > 1) {
    appendIssue(issues, {
      rule: 'delivery-contract/ambiguous',
      message: `当前执行匹配到多个活动交付合同：${candidates.map(({ parsed }) => parsed.data.contractId).join(', ')}`,
    });
    return null;
  }
  return candidates[0];
}

function verifyRegistryReferences(registry, contracts, loader, issues) {
  const contractsByPath = new Map(contracts.map((contract) => [contract.path, contract]));
  for (const sourcePath of registry.sourcePaths) {
    if (!loader.trackedFiles.has(sourcePath)) {
      appendIssue(issues, {
        rule: 'delivery-contract/feature-source-not-tracked',
        message: `功能登记表引用的本地需求或 UI 文件未受 Git 跟踪：${sourcePath}`,
        path: sourcePath,
      });
    }
  }
  for (const reference of registry.contracts.values()) {
    if (!loader.trackedFiles.has(reference.path)) {
      appendIssue(issues, {
        rule: 'delivery-contract/reference-not-tracked',
        message: `功能登记表引用的交付合同未受 Git 跟踪：${reference.path}`,
        path: reference.path,
      });
      continue;
    }
    const contract = contractsByPath.get(reference.path);
    if (!contract) {
      appendIssue(issues, {
        rule: 'delivery-contract/reference-missing',
        message: `功能登记表引用的交付合同无法读取：${reference.path}`,
        path: reference.path,
      });
      continue;
    }
    const { data } = contract.parsed;
    if (data.contractId !== reference.id) {
      appendIssue(issues, {
        rule: 'delivery-contract/reference-id-mismatch',
        message: `功能登记表合同 id ${reference.id} 与文件中的 ${data.contractId ?? '<missing>'} 不一致`,
        path: reference.path,
      });
    }
    if (data.featureId !== reference.featureId) {
      appendIssue(issues, {
        rule: 'delivery-contract/feature-mismatch',
        message: `合同 featureId ${data.featureId ?? '<missing>'} 与登记归属 ${reference.featureId} 不一致`,
        path: reference.path,
      });
    }
    const feature = registry.features.get(reference.featureId);
    if (data.lifecycle === 'active' && feature?.status !== 'active') {
      appendIssue(issues, {
        rule: 'delivery-contract/feature-not-active',
        message: `活动合同引用的功能 ${reference.featureId} 必须存在且状态为 active`,
        path: reference.path,
      });
    }
  }
  for (const contract of contracts) {
    const contractId = contract.parsed.data.contractId;
    if (typeof contractId === 'string' && !registry.contracts.has(contractId)) {
      appendIssue(issues, {
        rule: 'delivery-contract/unregistered',
        message: `交付合同 ${contractId} 未在功能登记表中登记`,
        path: contract.path,
      });
    }
  }
}

function verifyTrackedFiles(selected, loader, schema, issues) {
  const artifactDigests = [];
  const requirementDigests = [];
  for (const file of schema.requirementFiles) {
    if (!loader.trackedFiles.has(file.path)) {
      appendIssue(issues, {
        rule: 'delivery-contract/source-not-tracked',
        message: `需求来源文件未受 Git 跟踪：${file.path}`,
        path: file.path,
      });
      continue;
    }
    try {
      const actual = sha256Digest(loader.readBuffer(file.path));
      requirementDigests.push({ digest: actual, path: file.path });
      if (actual !== file.digest) {
        appendIssue(issues, {
          rule: 'delivery-contract/source-digest-mismatch',
          message: `需求来源文件指纹不一致：${file.path}；当前计算值为 ${actual}`,
          path: file.path,
        });
      }
    } catch (error) {
      appendIssue(issues, {
        rule: 'delivery-contract/source-read-failed',
        message: `无法读取需求来源文件 ${file.path}：${error.message}`,
        path: file.path,
      });
    }
  }
  const expectedBundle = selected.parsed.data.requirements?.sourceBundleDigest;
  const actualBundle = calculateSourceBundleDigest(requirementDigests);
  if (requirementDigests.length > 0 && expectedBundle !== actualBundle) {
    appendIssue(issues, {
      rule: 'delivery-contract/source-bundle-digest-mismatch',
      message: `需求来源整批指纹不一致；当前计算值为 ${actualBundle}`,
      path: selected.path,
    });
  }
  for (const artifact of schema.artifacts) {
    if (!loader.trackedFiles.has(artifact.path)) {
      appendIssue(issues, {
        rule: 'delivery-contract/artifact-not-tracked',
        message: `资料计划引用的文件未受 Git 跟踪：${artifact.path}`,
        path: artifact.path,
      });
      continue;
    }
    try {
      artifactDigests.push({
        digest: sha256Digest(loader.readBuffer(artifact.path)),
        kind: artifact.kind,
        mode: artifact.mode,
        path: artifact.path,
      });
    } catch (error) {
      appendIssue(issues, {
        rule: 'delivery-contract/artifact-read-failed',
        message: `无法读取资料计划文件 ${artifact.path}：${error.message}`,
        path: artifact.path,
      });
    }
  }
  return { artifactDigests, sourceBundleDigest: actualBundle };
}

function verifyGitBinding({ root, environment, branch, selected, issues, warnings }) {
  const { repository } = selected.parsed.data;
  const headCommit = currentHeadCommit(root);
  if (branch && repository.workingBranch !== branch) {
    appendIssue(issues, {
      rule: 'delivery-contract/branch-mismatch',
      message: `当前分支 ${branch} 与合同分支 ${repository.workingBranch} 不一致`,
      path: selected.path,
    });
  }
  if (!commitExists(root, repository.baselineCommit)) {
    appendIssue(issues, {
      rule: 'delivery-contract/baseline-missing',
      message: `合同基线提交不存在：${repository.baselineCommit}`,
      path: selected.path,
    });
  } else if (!isAncestorCommit(root, repository.baselineCommit, 'HEAD')) {
    appendIssue(issues, {
      rule: 'delivery-contract/baseline-not-ancestor',
      message: '合同 baselineCommit 不是当前 HEAD 的祖先',
      path: selected.path,
    });
  }
  const targetBranchCommit = resolveBranchCommit(root, repository.targetBranch);
  if (!targetBranchCommit) {
    appendIssue(issues, {
      rule: 'delivery-contract/target-branch-missing',
      message: `无法解析目标分支 ${repository.targetBranch}；请获取该分支后重新检查`,
      path: selected.path,
    });
  } else if (
    targetBranchCommit.commit !== repository.baselineCommit
    && selected.parsed.data.deliveryEvidence == null
  ) {
    appendIssue(warnings, {
      rule: 'delivery-contract/target-branch-drift',
      message: `目标分支 ${repository.targetBranch} 已从合同基线前进到 ${targetBranchCommit.commit}；最终交付前必须完成人工确认的影响分析`,
      path: selected.path,
    });
  }
  const worktree = inspectWorktree(root);
  const policy = repository.worktree?.policy;
  if (['manual', 'pre-commit'].includes(environment) && !worktree.linked) {
    const item = {
      rule: 'delivery-contract/worktree',
      message: policy === 'required'
        ? '合同要求在独立 Git Worktree 中开发，但当前是主工作树'
        : '合同建议在独立 Git Worktree 中开发，但当前是主工作树',
      path: selected.path,
    };
    if (policy === 'required') appendIssue(issues, item);
    else if (policy === 'preferred') appendIssue(warnings, item);
  }
  return { headCommit, targetBranchCommit };
}

function historicalContractVersions(root, selected, config) {
  const versions = [];
  for (const commit of listFileRevisionCommits(root, selected.path)) {
    const source = readFileAtRevision(root, commit, selected.path);
    if (!source) continue;
    const loader = createDeliveryContractRevisionLoader({ root, revision: commit, config });
    const { errors, parsed } = loadDeliveryContractBundle(loader, selected.path);
    if (parsed?.data?.contractId === selected.parsed.data.contractId && errors.length === 0) {
      versions.push({ commit, parsed });
    }
  }
  return versions;
}

function confirmationTime(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isNaN(timestamp) ? null : timestamp;
}

function historicalRequirementPaths(parsed, contractsDirectory) {
  const contractRoot = `${contractsDirectory}/${parsed.data.contractId}`;
  return (parsed.data.requirements?.sources ?? []).flatMap(({ files = [] }) => (
    files.map(({ path: filePath }) => (
      filePath.startsWith(`${contractRoot}/`) ? filePath : `${contractRoot}/${filePath}`
    ))
  ));
}

function verifyContractHistory(root, selected, definitionDigest, loader, config, issues) {
  const history = historicalContractVersions(root, selected, config);
  const removedSnapshots = [...new Set(history.flatMap(({ parsed }) => (
    historicalRequirementPaths(parsed, config.contractsDirectory)
  )))].filter((filePath) => !loader.trackedFiles.has(filePath));
  if (removedSnapshots.length > 0) {
    appendIssue(issues, {
      rule: 'delivery-contract/historical-snapshot-removed',
      message: `不得删除历史需求修订快照：${removedSnapshots.join(', ')}`,
      path: selected.path,
    });
  }
  const previous = history[0];
  if (previous) {
    const currentObligations = new Set(selected.parsed.obligations.map(({ id }) => id));
    const removedObligations = previous.parsed.obligations
      .map(({ id }) => id)
      .filter((id) => !currentObligations.has(id));
    if (removedObligations.length > 0) {
      appendIssue(issues, {
        rule: 'delivery-contract/obligation-removed',
        message: `不得从合同历史中删除已确认义务：${removedObligations.join(', ')}`,
        path: selected.path,
      });
    }
    const currentFindings = new Set(selected.parsed.findings.map(({ id }) => id));
    const removedFindings = previous.parsed.findings
      .map(({ id }) => id)
      .filter((id) => !currentFindings.has(id));
    if (removedFindings.length > 0) {
      appendIssue(issues, {
        rule: 'delivery-contract/finding-removed',
        message: `不得删除已经进入 Git 历史的正式交付发现：${removedFindings.join(', ')}`,
        path: selected.path,
      });
    }
  }

  const current = selected.parsed.data;
  const previousDefinition = history.find(({ parsed }) => (
    parsed.data.confirmation?.definitionDigest
    && parsed.data.confirmation.definitionDigest !== definitionDigest
  ));
  if (!previousDefinition) return;
  const previousData = previousDefinition.parsed.data;
  if (current.contractRevision !== previousData.contractRevision + 1) {
    appendIssue(issues, {
      rule: 'delivery-contract/revision-not-incremented',
      message: `合同定义已变化，contractRevision 必须从 ${previousData.contractRevision} 增加到 ${previousData.contractRevision + 1}`,
      path: selected.path,
    });
  }
  const previousConfirmedAt = confirmationTime(previousData.confirmation?.confirmedAt);
  const currentConfirmedAt = confirmationTime(current.confirmation?.confirmedAt);
  if (
    previousConfirmedAt == null
    || currentConfirmedAt == null
    || currentConfirmedAt <= previousConfirmedAt
  ) {
    appendIssue(issues, {
      rule: 'delivery-contract/reconfirmation-missing',
      message: '合同定义变化后必须记录晚于上一修订的新人工确认时间',
      path: selected.path,
    });
  }
  if (
    current.requirements?.sourceBundleDigest !== previousData.requirements?.sourceBundleDigest
    && current.requirements?.revision !== previousData.requirements?.revision + 1
  ) {
    appendIssue(issues, {
      rule: 'delivery-contract/requirements-revision-not-incremented',
      message: '需求来源整批指纹变化后，requirements.revision 必须连续增加并形成新的本地快照目录',
      path: selected.path,
    });
  }
}

function verifyHistoricalFeedback(selected, contracts, issues) {
  const current = selected.parsed.data;
  const applied = new Map((current.historicalFeedbackApplied ?? []).map((entry) => (
    [`${entry.sourceContractId}\0${entry.findingId}`, entry]
  )));
  const availableTargets = new Set([
    ...(current.requirements?.facts ?? []).map(({ id }) => id),
    ...selected.parsed.obligations.map(({ id }) => id),
    ...selected.parsed.obligations.map(({ details }) => details['门禁']).filter(Boolean),
  ]);
  for (const entry of current.historicalFeedbackApplied ?? []) {
    const missingTargets = entry.appliedAs.filter((target) => !availableTargets.has(target));
    if (missingTargets.length > 0) {
      appendIssue(issues, {
        rule: 'delivery-contract/historical-feedback-target-missing',
        message: `历史反馈 ${entry.findingId} 引用的当前合同义务不存在：${missingTargets.join(', ')}`,
        path: selected.path,
      });
    }
  }
  for (const contract of contracts) {
    if (
      contract === selected
      || contract.parsed.data.featureId !== current.featureId
      || contract.parsed.data.lifecycle !== 'closed'
    ) continue;
    for (const finding of contract.parsed.findings) {
      const recurrenceKey = finding.details['重复特征'];
      if (!recurrenceKey) continue;
      const application = applied.get(`${contract.parsed.data.contractId}\0${finding.id}`);
      if (!application || application.recurrenceKey !== recurrenceKey) {
        appendIssue(issues, {
          rule: 'delivery-contract/historical-feedback-not-applied',
          message: `同一功能的历史交付发现 ${finding.id} 尚未通过 historicalFeedbackApplied 转化为当前合同义务`,
          path: selected.path,
        });
      }
    }
  }
}

function effectiveBase(selected, root, issues) {
  const integrationBase = selected.parsed.data.deliveryEvidence?.integrationBaseCommit;
  if (!integrationBase) return selected.parsed.data.repository.baselineCommit;
  if (!commitExists(root, integrationBase) || !isAncestorCommit(root, integrationBase, 'HEAD')) {
    appendIssue(issues, {
      rule: 'delivery-contract/integration-base-invalid',
      message: `deliveryEvidence.integrationBaseCommit 不存在或不是 HEAD 的祖先：${integrationBase}`,
      path: selected.path,
    });
    return selected.parsed.data.repository.baselineCommit;
  }
  return integrationBase;
}

function verifyPathBoundary(selected, changes, issues) {
  const boundary = selected.parsed.data.repository.changeBoundary;
  for (const change of changes) {
    const requiredAllowedPaths = changePaths(change);
    const forbiddenPaths = [change.oldPath, change.path].filter(Boolean);
    for (const filePath of requiredAllowedPaths) {
      if (!matches(filePath, boundary.allowedPaths)) {
        appendIssue(issues, {
          rule: 'delivery-contract/path-not-allowed',
          message: `${filePath} 不在合同 allowedPaths 内（Git 状态 ${change.status}）`,
          path: filePath,
        });
      }
    }
    for (const filePath of forbiddenPaths) {
      if (matches(filePath, boundary.forbiddenPaths)) {
        appendIssue(issues, {
          rule: 'delivery-contract/path-forbidden',
          message: `${filePath} 命中合同 forbiddenPaths（Git 状态 ${change.status}）`,
          path: filePath,
        });
      }
    }
  }
}

function coordinationTarget(environment, issues, warnings) {
  return environment === 'release-ready' ? issues : warnings;
}

function verifyCoordination({
  baseCommit,
  config,
  contracts,
  changes,
  environment,
  issues,
  root,
  selected,
  warnings,
}) {
  const target = coordinationTarget(environment, issues, warnings);
  const endpoints = [...new Set(changes
    .flatMap((change) => triggerPaths(change))
    .filter((filePath) => (
      filePath !== selected.path
      && filePath !== config.registryPath
      && !filePath.startsWith(`${config.contractsDirectory}/`)
    )))];
  const overlapContractIds = [];
  for (const other of contracts) {
    if (other === selected) continue;
    const patterns = other.parsed.data.repository?.changeBoundary?.allowedPaths;
    if (!Array.isArray(patterns)) continue;
    const overlaps = endpoints.filter((filePath) => matches(filePath, patterns));
    if (overlaps.length === 0) continue;
    const otherId = other.parsed.data.contractId;
    overlapContractIds.push(otherId);
    const coordination = selected.parsed.data.coordination;
    const record = coordination?.overlaps?.find(({ withContractId }) => (
      withContractId === otherId
    ));
    if (!record) {
      appendIssue(target, {
        rule: 'delivery-contract/parallel-overlap-uncoordinated',
        message: `当前变更与合同 ${otherId} 的允许范围重叠但缺少协调记录：${overlaps.join(', ')}`,
        path: selected.path,
      });
      continue;
    }
    if (!['confirmed', 'resolved'].includes(record.status)) {
      appendIssue(target, {
        rule: 'delivery-contract/parallel-overlap-unresolved',
        message: `与合同 ${otherId} 的协调状态 ${record.status} 尚未由人工确认解决`,
        path: selected.path,
      });
    }
    const uncovered = overlaps.filter((filePath) => !matches(filePath, record.paths));
    if (uncovered.length > 0) {
      appendIssue(target, {
        rule: 'delivery-contract/parallel-overlap-incomplete',
        message: `与合同 ${otherId} 的协调记录未覆盖实际重叠路径：${uncovered.join(', ')}`,
        path: selected.path,
      });
    }
    if (['consolidate', 'cancel'].includes(record.strategy) && environment === 'release-ready') {
      appendIssue(issues, {
        rule: 'delivery-contract/parallel-contract-not-deliverable',
        message: `与合同 ${otherId} 的协调策略为 ${record.strategy}，当前合同不能继续独立发布`,
        path: selected.path,
      });
    }
    if (['integrate-after', 'extract-foundation'].includes(record.strategy)) {
      const dependency = coordination?.dependencies?.find(({ contractId }) => contractId === otherId);
      const landedCommit = dependency?.requiredLandedCommit;
      if (!dependency || !landedCommit) {
        appendIssue(target, {
          rule: 'delivery-contract/required-landed-commit-missing',
          message: `协调策略 ${record.strategy} 要求记录合同 ${otherId} 在目标分支的 requiredLandedCommit`,
          path: selected.path,
        });
      } else if (!commitExists(root, landedCommit) || !isAncestorCommit(root, landedCommit, 'HEAD')) {
        appendIssue(target, {
          rule: 'delivery-contract/required-landed-commit-not-integrated',
          message: `合同 ${otherId} 的落地提交不存在或尚未包含在当前 HEAD：${landedCommit}`,
          path: selected.path,
        });
      } else if (commitExists(root, baseCommit) && !isAncestorCommit(root, landedCommit, baseCommit)) {
        appendIssue(target, {
          rule: 'delivery-contract/integration-base-before-dependency',
          message: `最终集成基线 ${baseCommit} 尚未包含合同 ${otherId} 的落地提交 ${landedCommit}`,
          path: selected.path,
        });
      }
    }
    if (environment === 'release-ready') {
      const coverage = selected.parsed.data.regressionCoverage?.affectedContracts
        ?.find(({ contractId }) => contractId === otherId);
      if (!coverage) {
        appendIssue(issues, {
          rule: 'delivery-contract/regression-coverage-missing',
          message: `实际重叠合同 ${otherId} 缺少 regressionCoverage 回归记录`,
          path: selected.path,
        });
      } else if (coverage.verification.some(({ evidence, result }) => (
        result !== 'passed' || typeof evidence !== 'string' || evidence.trim() === ''
      ))) {
        appendIssue(issues, {
          rule: 'delivery-contract/regression-coverage-incomplete',
          message: `实际重叠合同 ${otherId} 的回归验证必须全部 passed 并提供证据`,
          path: selected.path,
        });
      }
    }
  }
  return overlapContractIds;
}

export function inspectDeliveryContract({ root, config, changes, environment }) {
  if (!config.enabled) return { enabled: false, issues: [], warnings: [] };
  const issues = [];
  const warnings = [];
  const loader = createDeliveryContractLoader({ root, environment, config });
  const registryValue = readRegistry(loader, config, issues);
  const registry = registryValue
    ? inspectFeatureRegistry(registryValue, config.registryPath, {
      contractsDirectory: config.contractsDirectory,
    })
    : {
      contracts: new Map(), features: new Map(), issues: [], sourcePaths: new Set(),
    };
  registry.issues.forEach((item) => appendIssue(issues, item));
  const contracts = readContracts(loader, issues);
  verifyRegistryReferences(registry, contracts, loader, issues);
  const branch = resolveDeliveryBranch(root);
  const explicitId = resolveDeliveryContractId();
  const isRequired = requiredChange(changes, config);
  const selected = selectContract(contracts, branch, explicitId, isRequired, issues);
  if (!selected) {
    return {
      branch,
      enabled: true,
      explicitId,
      issues,
      required: isRequired,
      selected: null,
      warnings,
    };
  }

  const schema = inspectContractSchema(selected.parsed, config);
  schema.issues.forEach((item) => appendIssue(issues, item, selected.path));
  const content = inspectContractContent(selected.parsed);
  content.issues.forEach((item) => appendIssue(issues, item, selected.path));
  const files = verifyTrackedFiles(selected, loader, schema, issues);
  const definitionDigest = calculateDefinitionDigest(selected.parsed, files.artifactDigests);
  if (selected.parsed.data.confirmation?.definitionDigest !== definitionDigest) {
    appendIssue(issues, {
      rule: 'delivery-contract/definition-digest-mismatch',
      message: `合同定义指纹不一致；当前计算值为 ${definitionDigest}，需要提升修订并重新人工确认`,
      path: selected.path,
    });
  }
  verifyContractHistory(root, selected, definitionDigest, loader, config, issues);
  verifyHistoricalFeedback(selected, contracts, issues);
  const artifactPlanDigest = calculateArtifactPlanDigest(selected.parsed.data.artifactPlan);
  const requirementFactsDigest = calculateRequirementFactsDigest(
    selected.parsed.data.requirements,
  );
  const gitBinding = verifyGitBinding({
    branch,
    environment,
    issues,
    root,
    selected,
    warnings,
  });
  const baseCommit = effectiveBase(selected, root, issues);
  let committedChanges = [];
  if (commitExists(root, baseCommit) && gitBinding.headCommit) {
    try {
      committedChanges = collectContractRevisionChanges(root, baseCommit, 'HEAD');
    } catch (error) {
      appendIssue(issues, {
        rule: 'delivery-contract/change-range-failed',
        message: `无法收集合同比较范围：${error.message}`,
        path: selected.path,
      });
    }
  }
  const contractChanges = uniqueChanges([...committedChanges, ...changes]);
  verifyPathBoundary(selected, contractChanges, issues);
  const overlapContractIds = verifyCoordination({
    baseCommit,
    config,
    contracts,
    changes: contractChanges,
    environment,
    issues,
    root,
    selected,
    warnings,
  });

  return {
    artifactDigests: files.artifactDigests,
    artifactPlanDigest,
    baseCommit,
    branch,
    changes: contractChanges,
    config,
    content,
    definitionDigest,
    enabled: true,
    explicitId,
    headCommit: gitBinding.headCommit,
    issues,
    overlapContractIds,
    loader,
    required: isRequired,
    requirementFactsDigest,
    root,
    schema,
    selected,
    sourceBundleDigest: files.sourceBundleDigest,
    targetBranchCommit: gitBinding.targetBranchCommit,
    warnings,
  };
}
