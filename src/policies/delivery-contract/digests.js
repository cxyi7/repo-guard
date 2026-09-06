import { createHash } from 'node:crypto';

const DEFINITION_SECTIONS = Object.freeze([
  '交付目标',
  '非目标',
  'Spec',
  'Design',
  'Tasks',
  'Examples',
  'Visuals',
  '验收条件',
]);
const DYNAMIC_DETAIL_KEYS = new Set([
  '证据',
  '确认人',
  '确认时间',
  '绑定提交',
  '绑定定义指纹',
  '技术证据指纹',
  '重新打开原因',
  '原证据状态',
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function sha256Digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function canonicalDigest(value) {
  return sha256Digest(JSON.stringify(canonicalize(value)));
}

function stableGateResult(result) {
  return {
    artifacts: result?.artifacts ?? [],
    diagnostics: result?.diagnostics ?? [],
    error: result?.error ?? null,
    findings: result?.findings ?? [],
    gateId: result?.gateId ?? null,
    metrics: result?.metrics ?? {},
    status: result?.status ?? null,
    summary: result?.summary ?? null,
  };
}

export function calculateGateResultDigest(result) {
  return canonicalDigest(stableGateResult(result));
}

export function calculateRequirementFactsDigest(requirements) {
  return canonicalDigest({
    blockingQuestions: requirements?.blockingQuestions ?? [],
    facts: requirements?.facts ?? [],
    revision: requirements?.revision ?? null,
    sourceBundleDigest: requirements?.sourceBundleDigest ?? null,
  });
}

export function calculateArtifactPlanDigest(artifactPlan) {
  return canonicalDigest(artifactPlan ?? null);
}

function withoutConfirmations(data) {
  const definition = { ...data };
  delete definition.confirmation;
  delete definition.deliveryEvidence;
  if (definition.requirements) {
    const requirements = { ...definition.requirements };
    delete requirements.confirmation;
    definition.requirements = requirements;
  }
  if (definition.artifactPlan) {
    const artifactPlan = { ...definition.artifactPlan };
    delete artifactPlan.confirmation;
    definition.artifactPlan = artifactPlan;
  }
  return definition;
}

function normalizedSection(parsed, name) {
  return (parsed.sections.get(name) ?? [])
    .join('\n')
    .trim()
    .replace(/[ \t]+$/gm, '');
}

function obligationDefinition(item) {
  return {
    actor: item.details['执行者'] ?? null,
    details: Object.fromEntries(
      Object.entries(item.details).filter(([key]) => !DYNAMIC_DETAIL_KEYS.has(key)),
    ),
    id: item.id,
    summary: item.summary,
  };
}

export function calculateDefinitionDigest(parsed, artifactDigests = []) {
  return canonicalDigest({
    artifacts: artifactDigests,
    body: Object.fromEntries(
      DEFINITION_SECTIONS.map((name) => [name, normalizedSection(parsed, name)]),
    ),
    contract: withoutConfirmations(structuredClone(parsed.data)),
    obligations: parsed.obligations.map(obligationDefinition),
  });
}

function findingExecution(finding) {
  return {
    checklist: finding.checklist.map((item) => ({
      checked: item.checked,
      details: item.details,
      id: item.id,
      summary: item.summary,
    })),
    details: finding.details,
    id: finding.id,
    summary: finding.summary,
  };
}

export function calculateExecutionDigest(parsed, deliveryEvidence) {
  return canonicalDigest({
    contractId: parsed.data.contractId,
    contractRevision: parsed.data.contractRevision,
    definitionDigest: parsed.data.confirmation?.definitionDigest ?? null,
    findings: parsed.findings.map(findingExecution),
    integrationBaseCommit: deliveryEvidence.integrationBaseCommit,
    evidenceRunDigest: deliveryEvidence.evidenceRunDigest ?? null,
    obligations: parsed.obligations.map((item) => ({
      checked: item.checked,
      details: item.details,
      id: item.id,
      summary: item.summary,
    })),
    subjectCommit: deliveryEvidence.subjectCommit,
  });
}

export function calculateTechnicalEvidenceDigest(parsed, deliveryEvidence, evidenceRun = null) {
  return canonicalDigest({
    contractId: parsed.data.contractId,
    contractRevision: parsed.data.contractRevision,
    definitionDigest: parsed.data.confirmation?.definitionDigest ?? null,
    evidenceRun: evidenceRun == null ? null : {
      data: evidenceRun.data,
      digest: evidenceRun.digest,
    },
    obligations: parsed.obligations
      .filter((item) => item.details['执行者'] !== 'human')
      .map((item) => ({
        checked: item.checked,
        evidence: item.details['证据'] ?? null,
        id: item.id,
      })),
    subjectCommit: deliveryEvidence.subjectCommit,
  });
}

export function calculateSourceBundleDigest(files) {
  const manifest = files
    .map(({ digest, path }) => `${path}\t${digest.replace(/^sha256:/, '')}`)
    .sort()
    .join('\n');
  return sha256Digest(manifest);
}
