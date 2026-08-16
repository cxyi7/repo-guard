import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { runExactNpmCommand } from '../../integrations/npm/external-script.js';
import { releaseEnvironment } from '../../integrations/npm/release-environment.js';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SENSITIVE_PACKAGE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|credentials?(?:\.|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|[^/]*(?:private[-_.]?key|secrets?|(?:access|auth|npm|refresh)[-_.]?token)[^/]*)/i;

function readJson(root, relativePath) {
  const target = path.join(root, relativePath);
  if (!existsSync(target)) throw configurationError('release-readiness/missing-json-file', `发布就绪检查要求提供 ${relativePath}`, {
    details: { location: { path: relativePath } },
  });
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw configurationError('release-readiness/invalid-json-file', `${relativePath} 必须包含有效 JSON：${error.message}`, {
      cause: error,
      details: { location: { path: relativePath } },
    });
  }
}

function collectExportTargets(value, targets = []) {
  if (typeof value === 'string') targets.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectExportTargets(entry, targets));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectExportTargets(entry, targets));
  }
  return targets;
}

function normalizedTarget(value) {
  return value.replace(/^\.\//, '').replaceAll('\\', '/');
}

function finding(ruleId, message, location, remediation) {
  return { ruleId, severity: 'error', message, location, remediation };
}

function inspectMetadata(root, manifest, packedFiles) {
  const findings = [];
  const addFinding = (ruleId, message, relativePath, remediation) => findings.push(finding(
    ruleId,
    message,
    { path: relativePath },
    remediation,
  ));

  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    addFinding('release/package-name', 'package.json 必须声明包名', 'package.json', '请将 package.json 的 name 设置为待发布的包名。');
  }
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
    addFinding('release/version', 'package.json 的 version 必须是精确的 SemVer 版本', 'package.json', '请设置不含范围或标签的精确 SemVer 版本。');
  }
  if (manifest.private === true) {
    addFinding('release/private-package', 'package.json 将该包标记为私有包', 'package.json', '请确认发布意图，并在执行发布就绪检查前将 private 设置为 false。');
  }

  const lock = readJson(root, 'package-lock.json');
  const lockRoot = lock.packages?.[''];
  if (lock.name !== manifest.name || lock.version !== manifest.version
    || lockRoot?.name !== manifest.name || lockRoot?.version !== manifest.version) {
    addFinding('release/lockfile-version', 'package-lock.json 根节点的名称和版本必须与 package.json 一致', 'package-lock.json', '请根据当前包元数据重新生成 package-lock.json。');
  }

  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    addFinding('release/changelog', '必须提供 CHANGELOG.md', 'CHANGELOG.md', '请为当前包版本添加发布记录。');
  } else if (SEMVER.test(manifest.version ?? '')) {
    const escaped = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^## ${escaped}(?:\\s|$)`, 'm').test(readFileSync(changelogPath, 'utf8'))) {
      addFinding('release/changelog', `CHANGELOG.md 缺少版本 ${manifest.version} 的标题`, 'CHANGELOG.md', `请添加“## ${manifest.version}”发布记录。`);
    }
  }

  const readmePath = path.join(root, 'README.md');
  if (!existsSync(readmePath)) {
    addFinding('release/readme-version', '必须提供 README.md 并声明当前包版本', 'README.md', '请创建 README.md，并添加与 package.json 一致的“当前版本”声明。');
  } else if (SEMVER.test(manifest.version ?? '')) {
    const versionDeclaration = `- 当前版本：\`${manifest.version}\``;
    const readmeLines = readFileSync(readmePath, 'utf8').split(/\r\n|\n|\r/);
    if (!readmeLines.includes(versionDeclaration)) {
      addFinding('release/readme-version', `README.md 的当前版本声明必须是 ${manifest.version}`, 'README.md', `请添加“${versionDeclaration}”，并同步更新安装示例。`);
    }
  }

  const schemaPaths = new Set([
    ...collectExportTargets(manifest.exports).map(normalizedTarget),
    ...(Array.isArray(manifest.files) ? manifest.files.map(normalizedTarget) : []),
  ].filter((target) => target.endsWith('.schema.json')));
  for (const schemaPath of schemaPaths) {
    let schema;
    try {
      schema = readJson(root, schemaPath);
    } catch (error) {
      addFinding('release/schema', error.message, schemaPath, '请在包声明的路径中创建有效的 JSON Schema。');
      continue;
    }
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      addFinding('release/schema-version', `${schemaPath} 必须声明 JSON Schema 2020-12 草案`, schemaPath, '请将 $schema 设置为 https://json-schema.org/draft/2020-12/schema。');
    }
  }

  const requiredTargets = new Set([
    ...collectExportTargets(manifest.exports).map(normalizedTarget),
    ...(typeof manifest.bin === 'string'
      ? [normalizedTarget(manifest.bin)]
      : Object.values(manifest.bin ?? {}).map(normalizedTarget)),
    ...schemaPaths,
    'package.json',
    'CHANGELOG.md',
    'README.md',
  ]);
  for (const target of requiredTargets) {
    const included = target.includes('*')
      ? micromatch.some([...packedFiles], target, { dot: true })
      : packedFiles.has(target);
    if (!included) {
      addFinding('release/artifact-missing', `${target} 已被声明或属于必需文件，但未出现在 npm pack 输出中`, 'package.json', '请更新 package.json 的 files 或 exports，或在发布前生成缺失的产物。');
    }
  }
  for (const packedPath of packedFiles) {
    if (SENSITIVE_PACKAGE_PATH.test(packedPath)) {
      addFinding('release/sensitive-artifact', `npm pack 将包含敏感路径 ${packedPath}`, packedPath, '请从发布包中移除该敏感文件。');
    }
  }
  return { findings, schemaCount: schemaPaths.size };
}

export async function inspectPackageReadiness({ root, signal, cacheDirectory = null }) {
  const manifest = readJson(root, 'package.json');
  const execution = await runExactNpmCommand({
    root,
    argumentsList: ['pack', '--dry-run', '--json', '--ignore-scripts'],
    signal,
    env: releaseEnvironment(process.env, cacheDirectory),
  });
  if (execution.status !== 0) {
    return {
      execution,
      findings: [],
      packageEntry: null,
      schemaCount: 0,
    };
  }
  let packReport;
  try {
    packReport = JSON.parse(execution.stdout);
  } catch (error) {
    throw executionError('release-readiness/invalid-pack-json', `npm pack --dry-run 返回了无效 JSON：${error.message}`, { cause: error });
  }
  if (!Array.isArray(packReport) || packReport.length !== 1 || !Array.isArray(packReport[0]?.files)) {
    throw executionError('release-readiness/invalid-pack-manifest', 'npm pack --dry-run 必须仅返回一个包含文件清单的包');
  }
  const packageEntry = packReport[0];
  const packedFiles = new Set(packageEntry.files.map(({ path: file }) => normalizedTarget(file)));
  const inspected = inspectMetadata(root, manifest, packedFiles);
  if (packageEntry.name !== manifest.name || packageEntry.version !== manifest.version) {
    inspected.findings.push(finding(
      'release/packed-identity',
      'npm pack 输出的名称和版本必须与 package.json 一致',
      { path: 'package.json' },
      '请在发布前统一包元数据。',
    ));
  }
  return { execution, packageEntry, ...inspected };
}
