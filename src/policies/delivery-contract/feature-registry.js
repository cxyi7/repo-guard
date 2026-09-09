import path from 'node:path';
import { normalizeGitPath } from '../../config/path-matching.js';

const NODE_KEYS = new Set([
  'id',
  'name',
  'status',
  'confirmedAt',
  'confirmedBy',
  'requirementSource',
  'uiSource',
  'description',
  'children',
  'deliveryContracts',
]);
const REF_KEYS = new Set(['id', 'path']);
const FEATURE_ID = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ISO_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function issue(issues, message, location) {
  issues.push({
    rule: 'delivery-contract/feature-registry',
    message,
    path: location,
  });
}

function exactKeys(value, allowed, label, issues, location) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    issue(issues, `${label} 包含不支持的字段：${unknown.join(', ')}`, location);
  }
}

function validNullableText(value) {
  return value === null || (typeof value === 'string' && value.trim() !== '');
}

function localReferencePath(value, label, issues, registryPath) {
  if (value === null || /^https:\/\//i.test(value.trim())) return null;
  const normalized = normalizeGitPath(value.trim());
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    || path.isAbsolute(value)
    || normalized.startsWith('/')
    || normalized.startsWith('!')
    || normalized.split('/').includes('..')
  ) {
    issue(issues, `${label} 必须是 HTTPS 地址或仓库内相对路径`, registryPath);
    return null;
  }
  return normalized;
}

export function inspectFeatureRegistry(
  registry,
  registryPath,
  { contractsDirectory = null } = {},
) {
  const issues = [];
  const features = new Map();
  const contracts = new Map();
  const sourcePaths = new Set();
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    issue(issues, '功能登记表必须是 JSON 对象', registryPath);
    return { contracts, features, issues, sourcePaths };
  }
  exactKeys(registry, new Set(['schemaVersion', 'features']), '功能登记表', issues, registryPath);
  if (registry.schemaVersion !== 2) {
    issue(issues, '功能登记表 schemaVersion 必须为 2；旧格式不再支持，请按当前规范重新建立', registryPath);
    return { contracts, features, issues, sourcePaths };
  }
  if (!Array.isArray(registry.features)) {
    issue(issues, '功能登记表 features 必须是数组', registryPath);
    return { contracts, features, issues, sourcePaths };
  }

  const visit = (node, parentId, position) => {
    const label = `功能节点 ${position}`;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      issue(issues, `${label} 必须是对象`, registryPath);
      return;
    }
    exactKeys(node, NODE_KEYS, label, issues, registryPath);
    if (typeof node.id !== 'string' || !FEATURE_ID.test(node.id)) {
      issue(issues, `${label}.id 必须是稳定的功能标识`, registryPath);
    } else if (features.has(node.id)) {
      issue(issues, `功能 id 重复：${node.id}`, registryPath);
    } else {
      features.set(node.id, { ...node, parentId });
    }
    for (const field of ['name', 'description']) {
      if (typeof node[field] !== 'string' || node[field].trim() === '') {
        issue(issues, `${label}.${field} 必须是非空字符串`, registryPath);
      }
    }
    if (!['proposed', 'active', 'retired'].includes(node.status)) {
      issue(issues, `${label}.status 必须为 proposed、active 或 retired`, registryPath);
    }
    for (const field of ['requirementSource', 'uiSource']) {
      if (!validNullableText(node[field])) {
        issue(issues, `${label}.${field} 必须是非空字符串或 null`, registryPath);
      } else if (node[field] !== null) {
        const sourcePath = localReferencePath(
          node[field],
          `${label}.${field}`,
          issues,
          registryPath,
        );
        if (sourcePath) sourcePaths.add(sourcePath);
      }
    }
    if (node.status === 'proposed') {
      if (node.confirmedAt !== null || node.confirmedBy !== null) {
        issue(issues, `${label} 为 proposed 时确认时间和确认人必须为 null`, registryPath);
      }
    } else {
      if (typeof node.confirmedBy !== 'string' || node.confirmedBy.trim() === '') {
        issue(issues, `${label} 已确认或退役时必须记录确认人`, registryPath);
      }
      if (typeof node.confirmedAt !== 'string' || !ISO_TIMEZONE.test(node.confirmedAt)) {
        issue(issues, `${label} 已确认或退役时必须记录带时区的 ISO 8601 确认时间`, registryPath);
      }
    }
    if (!Array.isArray(node.children)) {
      issue(issues, `${label}.children 必须是数组，没有子功能时使用空数组`, registryPath);
    }
    if (!Array.isArray(node.deliveryContracts)) {
      issue(issues, `${label}.deliveryContracts 必须是数组，没有合同时使用空数组`, registryPath);
    } else {
      node.deliveryContracts.forEach((reference, index) => {
        const referenceLabel = `${label}.deliveryContracts[${index}]`;
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
          issue(issues, `${referenceLabel} 必须是对象`, registryPath);
          return;
        }
        exactKeys(reference, REF_KEYS, referenceLabel, issues, registryPath);
        if (typeof reference.id !== 'string' || !FEATURE_ID.test(reference.id)) {
          issue(issues, `${referenceLabel}.id 必须是稳定的合同标识`, registryPath);
          return;
        }
        if (typeof reference.path !== 'string' || reference.path.trim() === '') {
          issue(issues, `${referenceLabel}.path 必须是仓库相对路径`, registryPath);
          return;
        }
        const normalizedPath = normalizeGitPath(reference.path.trim());
        if (
          path.isAbsolute(reference.path)
          || normalizedPath.startsWith('/')
          || normalizedPath.startsWith('!')
          || normalizedPath.split('/').includes('..')
        ) {
          issue(issues, `${referenceLabel}.path 必须是安全的仓库内相对路径`, registryPath);
          return;
        }
        if (contractsDirectory && !normalizedPath.startsWith(`${contractsDirectory}/`)) {
          issue(
            issues,
            `${referenceLabel}.path 必须位于合同目录 ${contractsDirectory}`,
            registryPath,
          );
          return;
        }
        if (
          contractsDirectory
          && normalizedPath.slice(`${contractsDirectory}/`.length).includes('/')
        ) {
          issue(
            issues,
            `${referenceLabel}.path 必须是 ${contractsDirectory} 的直接子文件，合同资料应放在同名子目录中`,
            registryPath,
          );
          return;
        }
        if (contracts.has(reference.id)) {
          issue(issues, `交付合同引用 id 重复：${reference.id}`, registryPath);
          return;
        }
        if ([...contracts.values()].some(({ path }) => path === normalizedPath)) {
          issue(issues, `交付合同引用路径重复：${normalizedPath}`, registryPath);
          return;
        }
        contracts.set(reference.id, {
          featureId: node.id,
          id: reference.id,
          path: normalizedPath,
        });
      });
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) => visit(
        child,
        node.id,
        `${position}.children[${index}]`,
      ));
    }
  };

  registry.features.forEach((node, index) => visit(node, null, `features[${index}]`));
  return { contracts, features, issues, sourcePaths };
}
