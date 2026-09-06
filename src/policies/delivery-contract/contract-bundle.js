import path from 'node:path';
import { normalizeGitPath } from '../../config/path-matching.js';
import { parseDeliveryContractMarkdown, parseMarkdownFrontmatter } from './markdown.js';

const COMPONENT_KEYS = Object.freeze([
  'requirements',
  'traceability',
  'obligations',
  'findingsDirectory',
]);
const COMPONENT_FIELDS = Object.freeze({
  requirements: Object.freeze([
    'schemaVersion', 'documentType', 'contractId', 'revision', 'confirmation',
    'sources', 'sourceBundleDigest', 'facts', 'blockingQuestions',
  ]),
  traceability: Object.freeze([
    'schemaVersion', 'documentType', 'contractId', 'entries',
  ]),
  obligations: Object.freeze(['schemaVersion', 'documentType', 'contractId']),
  finding: Object.freeze(['schemaVersion', 'documentType', 'contractId', 'findingId']),
});

function componentError(errors, filePath, message) {
  errors.push(`${filePath}：${message}`);
}

function safeComponentPath(contractRoot, value, label, errors, { directory = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`materials.${label} 必须是非空字符串`);
    return null;
  }
  const normalized = normalizeGitPath(value.trim());
  if (
    path.isAbsolute(value)
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').includes('..')
  ) {
    errors.push(`materials.${label} 必须是当前合同目录内的安全相对路径`);
    return null;
  }
  const resolved = normalized.startsWith(`${contractRoot}/`)
    ? normalized
    : `${contractRoot}/${normalized}`;
  if (!resolved.startsWith(`${contractRoot}/`)) {
    errors.push(`materials.${label} 必须位于 ${contractRoot}`);
    return null;
  }
  if (!directory && !resolved.endsWith('.md')) {
    errors.push(`materials.${label} 必须引用 Markdown 文件`);
    return null;
  }
  return resolved.replace(/\/$/, '');
}

function readComponent(loader, filePath, errors) {
  if (!filePath) return null;
  if (!loader.trackedFiles.has(filePath)) {
    componentError(errors, filePath, '合同组成文件未受 Git 跟踪');
    return null;
  }
  try {
    return loader.readText(filePath);
  } catch (error) {
    componentError(errors, filePath, `无法读取合同组成文件：${error.message}`);
    return null;
  }
}

function validateComponentHeader(data, { contractId, documentType, filePath }, errors) {
  if (!data) return false;
  const unknown = Object.keys(data).filter((key) => !COMPONENT_FIELDS[documentType].includes(key));
  if (unknown.length > 0) {
    componentError(errors, filePath, `包含不支持的字段：${unknown.join(', ')}`);
  }
  for (const key of COMPONENT_FIELDS[documentType]) {
    if (!Object.hasOwn(data, key)) componentError(errors, filePath, `缺少必填字段：${key}`);
  }
  if (data.schemaVersion !== 2) {
    componentError(errors, filePath, 'schemaVersion 必须为 2');
  }
  if (data.documentType !== documentType) {
    componentError(errors, filePath, `documentType 必须为 ${documentType}`);
  }
  if (data.contractId !== contractId) {
    componentError(errors, filePath, `contractId 必须为 ${contractId}`);
  }
  return unknown.length === 0
    && data.schemaVersion === 2
    && data.documentType === documentType
    && data.contractId === contractId;
}

function parseStructuredComponent(loader, filePath, documentType, contractId, errors) {
  const source = readComponent(loader, filePath, errors);
  if (source == null) return null;
  const parsed = parseMarkdownFrontmatter(source);
  parsed.errors.forEach((message) => componentError(errors, filePath, message));
  if (!validateComponentHeader(parsed.data, {
    contractId,
    documentType,
    filePath,
  }, errors)) return null;
  return { ...parsed, path: filePath, source };
}

function parseChecklistComponent(loader, filePath, contractId, errors) {
  const source = readComponent(loader, filePath, errors);
  if (source == null) return null;
  const parsed = parseDeliveryContractMarkdown(source);
  parsed.errors.forEach((message) => componentError(errors, filePath, message));
  if (!validateComponentHeader(parsed.data, {
    contractId,
    documentType: 'obligations',
    filePath,
  }, errors)) return null;
  if (parsed.obligations.length === 0) {
    componentError(errors, filePath, '必须包含“## 交付执行清单”和至少一个受约束复选项');
  }
  return { ...parsed, path: filePath, source };
}

function parseFindingComponents(loader, directory, contractId, errors) {
  if (!directory) return [];
  const prefix = `${directory}/`;
  const paths = [...loader.trackedFiles]
    .filter((filePath) => filePath.startsWith(prefix)
      && filePath.endsWith('.md')
      && !filePath.slice(prefix.length).includes('/'))
    .sort();
  return paths.flatMap((filePath) => {
    const source = readComponent(loader, filePath, errors);
    if (source == null) return [];
    const parsed = parseDeliveryContractMarkdown(source);
    parsed.errors.forEach((message) => componentError(errors, filePath, message));
    if (!validateComponentHeader(parsed.data, {
      contractId,
      documentType: 'finding',
      filePath,
    }, errors)) return [];
    if (parsed.findings.length !== 1) {
      componentError(errors, filePath, '每个发现文件必须且只能包含一个 FND-*');
      return [];
    }
    if (parsed.data.findingId !== parsed.findings[0].id) {
      componentError(errors, filePath, 'findingId 必须与正文中的 FND-* 标识一致');
    }
    return [{ ...parsed.findings[0], path: filePath }];
  });
}

export function loadDeliveryContractBundle(loader, contractPath) {
  const errors = [];
  let source;
  try {
    source = loader.readText(contractPath);
  } catch (error) {
    return {
      errors: [`无法读取交付合同 ${contractPath}：${error.message}`],
      parsed: null,
      source: null,
    };
  }
  const main = parseDeliveryContractMarkdown(source);
  errors.push(...main.errors.map((message) => `${contractPath}：${message}`));
  if (!main.data) return { errors, parsed: main, source };
  if (main.data.schemaVersion !== 2) {
    errors.push(`${contractPath}：交付合同 schemaVersion 必须为 2`);
    return { errors, parsed: main, source };
  }
  const contractId = main.data.contractId;
  const contractRoot = `${path.posix.dirname(contractPath)}/${contractId}`;
  const materials = main.data.materials;
  if (!materials || typeof materials !== 'object' || Array.isArray(materials)) {
    errors.push(`${contractPath}：materials 必须是对象`);
    return { errors, parsed: main, source };
  }
  const unknown = Object.keys(materials).filter((key) => !COMPONENT_KEYS.includes(key));
  if (unknown.length > 0) {
    errors.push(`${contractPath}：materials 包含不支持的字段：${unknown.join(', ')}`);
  }
  for (const key of COMPONENT_KEYS) {
    if (!Object.hasOwn(materials, key)) errors.push(`${contractPath}：materials 缺少 ${key}`);
  }
  const componentPaths = {
    requirements: safeComponentPath(contractRoot, materials.requirements, 'requirements', errors),
    traceability: safeComponentPath(contractRoot, materials.traceability, 'traceability', errors),
    obligations: safeComponentPath(contractRoot, materials.obligations, 'obligations', errors),
    findingsDirectory: safeComponentPath(
      contractRoot,
      materials.findingsDirectory,
      'findingsDirectory',
      errors,
      { directory: true },
    ),
  };
  const requirements = parseStructuredComponent(
    loader,
    componentPaths.requirements,
    'requirements',
    contractId,
    errors,
  );
  const traceability = parseStructuredComponent(
    loader,
    componentPaths.traceability,
    'traceability',
    contractId,
    errors,
  );
  const obligations = parseChecklistComponent(
    loader,
    componentPaths.obligations,
    contractId,
    errors,
  );
  const findings = parseFindingComponents(
    loader,
    componentPaths.findingsDirectory,
    contractId,
    errors,
  );
  const requirementData = requirements?.data
    ? Object.fromEntries(Object.entries(requirements.data).filter(([key]) => (
      !['schemaVersion', 'documentType', 'contractId'].includes(key)
    )))
    : null;
  const traceabilityData = traceability?.data?.entries ?? null;
  const parsed = {
    ...main,
    componentPaths: {
      ...componentPaths,
      findings: findings.map(({ path: filePath }) => filePath),
    },
    components: { obligations, requirements, traceability },
    data: {
      ...main.data,
      requirements: requirementData,
      traceability: traceabilityData,
    },
    errors,
    findings,
    mainData: main.data,
    obligations: obligations?.obligations ?? [],
  };
  return { errors, parsed, source };
}
