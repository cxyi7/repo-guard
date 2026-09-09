import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityError } from '../../core/error/repo-guard-error.js';

const SKILL_NAMES = Object.freeze([
  'repo-guard-feature-registry',
  'repo-guard-delivery-contract',
  'repo-guard-contract-execution',
  'repo-guard-delivery-feedback',
  'repo-guard-delivery-evidence',
]);
const MANIFEST_PATH = '.repo-guard/managed-skills.json';
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'skills');
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function relativeFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? relativeFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}

function sourceFiles() {
  return SKILL_NAMES.flatMap((skillName) => {
    const sourceDirectory = path.join(SOURCE_ROOT, skillName);
    return relativeFiles(sourceDirectory).map((relativePath) => {
      const source = readFileSync(path.join(sourceDirectory, ...relativePath.split('/')));
      return {
        digest: digest(source),
        path: `.agents/skills/${skillName}/${relativePath}`,
        source,
      };
    });
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function absolute(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function exactKeys(value, expected) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && Object.keys(value).every((key) => expected.includes(key));
}

function managedSkillPath(filePath) {
  if (typeof filePath !== 'string' || filePath.includes('\\')) return false;
  const parts = filePath.split('/');
  return parts.length >= 4
    && parts[0] === '.agents'
    && parts[1] === 'skills'
    && SKILL_NAMES.includes(parts[2])
    && parts.slice(3).every((part) => part !== '' && part !== '.' && part !== '..');
}

function validManifest(value, expectedPaths) {
  if (!exactKeys(
    value,
    ['schemaVersion', 'feature', 'repoGuardVersion', 'skills', 'files'],
  )) return false;
  if (
    value.schemaVersion !== 2
    || value.feature !== 'deliveryContract'
    || !VERSION.test(value.repoGuardVersion ?? '')
    || !Array.isArray(value.skills)
    || value.skills.length !== SKILL_NAMES.length
    || value.skills.some((skillName, index) => skillName !== SKILL_NAMES[index])
    || !Array.isArray(value.files)
  ) return false;
  const paths = new Set();
  for (const file of value.files) {
    if (
      !exactKeys(file, ['path', 'digest'])
      || !managedSkillPath(file.path)
      || !expectedPaths.has(file.path)
      || !DIGEST.test(file.digest ?? '')
      || paths.has(file.path)
    ) return false;
    paths.add(file.path);
  }
  return paths.size === expectedPaths.size;
}

function readManifest(root, expectedFiles) {
  const manifestPath = absolute(root, MANIFEST_PATH);
  if (!existsSync(manifestPath)) return null;
  try {
    const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const expectedPaths = new Set(expectedFiles.map(({ path: filePath }) => filePath));
    return validManifest(value, expectedPaths) ? value : null;
  } catch {
    return null;
  }
}

function manifestExists(root) {
  return existsSync(absolute(root, MANIFEST_PATH));
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
}

function currentDigest(root, relativePath) {
  const target = absolute(root, relativePath);
  return existsSync(target) ? digest(readFileSync(target)) : null;
}

function assertSafeToReplace(root, expectedFiles, previousFiles) {
  for (const file of expectedFiles) {
    const current = currentDigest(root, file.path);
    if (current == null || current === file.digest) continue;
    const previous = previousFiles.get(file.path);
    if (!previous || previous.digest !== current) {
      throw securityError(
        'delivery-skills/non-managed-file',
        `拒绝覆盖人工修改或非 repo-guard 托管的 Skill 文件：${file.path}`,
        { remediation: '备份或移走该文件后运行 repo-guard doctor --fix。' },
      );
    }
  }
}

function removeEmptyParents(root, relativePath) {
  const stop = absolute(root, '.agents/skills');
  let current = path.dirname(absolute(root, relativePath));
  while (current.startsWith(`${stop}${path.sep}`)) {
    if (!existsSync(current) || readdirSync(current).length > 0) return;
    rmdirSync(current);
    current = path.dirname(current);
  }
}

function manifestValue(files) {
  return {
    schemaVersion: 2,
    feature: 'deliveryContract',
    repoGuardVersion: packageVersion(),
    skills: [...SKILL_NAMES],
    files: files.map(({ digest: fileDigest, path: filePath }) => ({
      path: filePath,
      digest: fileDigest,
    })),
  };
}

/** 允许清单缺失或当前内容待同步；只拒绝无法安全解释的已有清单。 */
export function assertDeliverySkillManifestFormat(root, expectedFiles = sourceFiles()) {
  const previous = readManifest(root, expectedFiles);
  if (manifestExists(root) && !previous) {
    throw securityError(
      'delivery-skills/invalid-manifest',
      `拒绝处理无法解析或版本不受支持的托管 Skill 清单：${MANIFEST_PATH}`,
      { remediation: '托管 Skill 清单仅支持 schemaVersion: 2。请人工保存并处理旧清单与文件，按当前格式重新接入；不会自动转换或覆盖。' },
    );
  }
  return previous;
}

export function syncDeliverySkills(root, enabled) {
  const expectedFiles = sourceFiles();
  const previous = assertDeliverySkillManifestFormat(root, expectedFiles);
  const previousFiles = new Map((previous?.files ?? []).map((file) => [file.path, file]));
  if (!enabled) {
    if (!previous) return { changed: false, enabled: false, skills: [] };
    for (const file of previous?.files ?? []) {
      const target = absolute(root, file.path);
      if (!existsSync(target)) continue;
      if (currentDigest(root, file.path) !== file.digest) {
        throw securityError(
          'delivery-skills/modified-file',
          `拒绝删除已经人工修改的 Skill 文件：${file.path}`,
          { remediation: '保留该文件并手工处理，或恢复托管版本后重新禁用。' },
        );
      }
    }
    let changed = false;
    for (const file of previous?.files ?? []) {
      const target = absolute(root, file.path);
      if (!existsSync(target)) continue;
      unlinkSync(target);
      removeEmptyParents(root, file.path);
      changed = true;
    }
    const manifestPath = absolute(root, MANIFEST_PATH);
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
      changed = true;
    }
    return { changed, enabled: false, skills: [] };
  }

  assertSafeToReplace(root, expectedFiles, previousFiles);

  let changed = false;
  for (const file of expectedFiles) {
    const target = absolute(root, file.path);
    if (currentDigest(root, file.path) === file.digest) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.source);
    changed = true;
  }
  const nextManifest = `${JSON.stringify(manifestValue(expectedFiles), null, 2)}\n`;
  const manifestPath = absolute(root, MANIFEST_PATH);
  const currentManifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null;
  if (currentManifest !== nextManifest) {
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, nextManifest, 'utf8');
    changed = true;
  }
  return { changed, enabled: true, skills: [...SKILL_NAMES] };
}

export function inspectDeliverySkills(root, enabled) {
  const expectedFiles = sourceFiles();
  const manifest = readManifest(root, expectedFiles);
  const hasManifest = manifestExists(root);
  if (!enabled) {
    return !hasManifest
      ? { issues: [], skills: [] }
      : {
          issues: [manifest
            ? '交付合同功能已禁用，但仍存在 repo-guard 托管 Skill 清单'
            : `交付合同功能已禁用，但存在无法解析的托管 Skill 清单：${MANIFEST_PATH}`],
          skills: [],
        };
  }
  const issues = [];
  if (!manifest) issues.push(`缺少或无法解析托管 Skill 清单：${MANIFEST_PATH}`);
  const manifestFiles = new Map((manifest?.files ?? []).map((file) => [file.path, file]));
  for (const file of expectedFiles) {
    const current = currentDigest(root, file.path);
    if (current == null) issues.push(`缺少托管 Skill 文件：${file.path}`);
    else if (current !== file.digest) issues.push(`托管 Skill 文件已变化或过期：${file.path}`);
    if (manifestFiles.get(file.path)?.digest !== file.digest) {
      issues.push(`托管 Skill 清单未绑定当前文件：${file.path}`);
    }
  }
  return { issues: [...new Set(issues)], skills: [...SKILL_NAMES] };
}

export const managedDeliverySkillNames = SKILL_NAMES;
