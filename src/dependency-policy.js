import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import { runGit } from './git.js';

const DECLARATION_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const LOCKED_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
]);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parseJsonFile(target, label) {
  let source;
  try {
    source = readFileSync(target, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${error.message}`);
  }
}

function skipJsonString(source, start) {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') cursor += 2;
    else if (source[cursor] === '"') return cursor + 1;
    else cursor += 1;
  }
  return source.length;
}

function objectRange(source, property) {
  let containerDepth = 0;
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] === '"') {
      const stringEnd = skipJsonString(source, cursor);
      let valueStart = stringEnd;
      while (/\s/.test(source[valueStart])) valueStart += 1;
      if (
        containerDepth === 1
        && JSON.parse(source.slice(cursor, stringEnd)) === property
        && source[valueStart] === ':'
      ) {
        valueStart += 1;
        while (/\s/.test(source[valueStart])) valueStart += 1;
        if (source[valueStart] === '{') {
          let objectDepth = 1;
          let index = valueStart + 1;
          while (index < source.length && objectDepth > 0) {
            if (source[index] === '"') index = skipJsonString(source, index);
            else {
              if (source[index] === '{') objectDepth += 1;
              if (source[index] === '}') objectDepth -= 1;
              index += 1;
            }
          }
          return { end: index - 1, start: valueStart + 1 };
        }
      }
      cursor = stringEnd;
      continue;
    }
    if (source[cursor] === '{' || source[cursor] === '[') containerDepth += 1;
    if (source[cursor] === '}' || source[cursor] === ']') containerDepth -= 1;
    cursor += 1;
  }
  return null;
}

function objectPropertyOffset(source, range, property) {
  let containerDepth = 1;
  let cursor = range.start;
  while (cursor < range.end) {
    if (source[cursor] === '"') {
      const stringEnd = skipJsonString(source, cursor);
      let colon = stringEnd;
      while (/\s/.test(source[colon])) colon += 1;
      if (
        containerDepth === 1
        && JSON.parse(source.slice(cursor, stringEnd)) === property
        && source[colon] === ':'
      ) return cursor;
      cursor = stringEnd;
      continue;
    }
    if (source[cursor] === '{' || source[cursor] === '[') containerDepth += 1;
    if (source[cursor] === '}' || source[cursor] === ']') containerDepth -= 1;
    cursor += 1;
  }
  return -1;
}

function location(source, offset) {
  const before = source.slice(0, Math.max(0, offset));
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: offset - lastNewline,
  };
}

function declarationLocation(source, section, name) {
  const range = objectRange(source, section);
  if (!range) return { line: 1, column: 1 };
  const offset = objectPropertyOffset(source, range, name);
  if (offset === -1) return { line: 1, column: 1 };
  return location(source, offset);
}

function dependencySource(specifier) {
  if (/^(?:~[\\/]|\.\.?[\\/]|[A-Za-z]:[\\/]|[\\/])/.test(specifier)
    || /\.tgz(?:#.*)?$/i.test(specifier)) return 'file';
  const protocol = protocolOf(specifier);
  if (protocol) return protocol;
  if (/^git@[^:]+:.+/.test(specifier)) return 'git+ssh';
  if (/^[^\s/]+\/[^\s/]+(?:#.*)?$/.test(specifier)) return 'github';
  return null;
}

function isExactAllowedVersion(specifier, allowedProtocols, source) {
  if (EXACT_VERSION.test(specifier)) return true;
  if (!source || !allowedProtocols.includes(source)) return false;
  if (source !== 'npm') return true;
  const protocolMatch = /^npm:(.*)$/i.exec(specifier);
  if (!protocolMatch) return false;
  const alias = protocolMatch[1];
  const separator = alias.lastIndexOf('@');
  return separator > 0 && EXACT_VERSION.test(alias.slice(separator + 1));
}

function protocolOf(specifier) {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(specifier);
  return match?.[1].toLowerCase() ?? null;
}

function finding({ source, section, name, rule, message, specifier = null }) {
  return {
    ...declarationLocation(source, section, name),
    dependency: name,
    message,
    path: 'package.json',
    rule,
    section,
    specifier,
  };
}

function inspectDeclarations(packageJson, source, config) {
  const findings = [];
  const sectionsByPackage = new Map();
  const banned = new Map(config.bannedPackages.map((item) => [item.name, item]));

  for (const section of DECLARATION_SECTIONS) {
    const declarations = packageJson[section] ?? {};
    if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations)) {
      findings.push({
        ...declarationLocation(source, section, section),
        message: `package.json ${section} must be an object`,
        path: 'package.json',
        rule: 'dependencies/invalid-declarations',
        section,
      });
      continue;
    }
    for (const [name, specifier] of Object.entries(declarations)) {
      const sections = sectionsByPackage.get(name) ?? [];
      sections.push(section);
      sectionsByPackage.set(name, sections);
      const ban = banned.get(name);
      if (ban) {
        findings.push(finding({
          source,
          section,
          name,
          rule: 'dependencies/banned-package',
          message: `${name} is banned: ${ban.reason}`
            + (ban.replacement ? `; use ${ban.replacement}` : ''),
          specifier,
        }));
      }
      if (typeof specifier !== 'string' || !specifier.trim()) {
        findings.push(finding({
          source,
          section,
          name,
          rule: 'dependencies/invalid-specifier',
          message: `${name} must use a non-empty string dependency specifier`,
          specifier,
        }));
        continue;
      }
      const sourceKind = dependencySource(specifier);
      if (sourceKind && !config.allowedProtocols.includes(sourceKind)) {
        findings.push(finding({
          source,
          section,
          name,
          rule: 'dependencies/disallowed-source',
          message: `${name} uses disallowed ${sourceKind}: source`,
          specifier,
        }));
      } else if (
        section !== 'peerDependencies'
        && config.requireExactVersions
        && !isExactAllowedVersion(specifier, config.allowedProtocols, sourceKind)
      ) {
        findings.push(finding({
          source,
          section,
          name,
          rule: 'dependencies/non-exact-version',
          message: `${name} must use an exact version; found ${specifier}`,
          specifier,
        }));
      }
    }
  }

  for (const [name, sections] of sectionsByPackage) {
    const nonPeerSections = sections.filter((section) => section !== 'peerDependencies');
    if (nonPeerSections.length <= 1) continue;
    findings.push(finding({
      source,
      section: nonPeerSections[0],
      name,
      rule: 'dependencies/duplicate-declaration',
      message: `${name} is declared in multiple dependency sections: ${nonPeerSections.join(', ')}`,
    }));
  }
  return findings;
}

function compareLockfile(packageJson, lockfile, lockSource) {
  const root = lockfile.packages?.[''];
  if (!root || !Number.isInteger(lockfile.lockfileVersion) || lockfile.lockfileVersion < 2) {
    return [{
      ...location(lockSource, 0),
      message: 'package-lock.json must use lockfileVersion 2 or newer with a root package entry',
      path: 'package-lock.json',
      rule: 'dependencies/invalid-lockfile',
    }];
  }
  const findings = [];
  for (const section of LOCKED_SECTIONS) {
    const expected = packageJson[section] ?? {};
    const actual = root[section] ?? {};
    const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const name of names) {
      if (expected[name] === actual[name]) continue;
      findings.push({
        ...declarationLocation(lockSource, section, name),
        dependency: name,
        message: `package-lock root ${section}.${name} does not match package.json `
          + `(expected=${expected[name] ?? '<absent>'}, actual=${actual[name] ?? '<absent>'})`,
        path: 'package-lock.json',
        rule: 'dependencies/lockfile-mismatch',
        section,
      });
    }
  }
  return findings;
}

export function inspectDependencyPolicy({ root, config, exceptions }) {
  const packagePath = path.join(root, 'package.json');
  const packageFile = parseJsonFile(packagePath, 'package.json');
  let findings = inspectDeclarations(packageFile.value, packageFile.source, config);
  const lockPath = path.join(root, 'package-lock.json');
  if (config.requireLockfile) {
    if (!existsSync(lockPath)) {
      findings.push({
        line: 1,
        column: 1,
        message: 'package-lock.json is required for reproducible npm installs',
        path: 'package.json',
        rule: 'dependencies/missing-lockfile',
      });
    } else {
      const lockFile = parseJsonFile(lockPath, 'package-lock.json');
      findings = findings.concat(compareLockfile(
        packageFile.value,
        lockFile.value,
        lockFile.source,
      ));
    }
  }
  const approved = [];
  const violations = [];
  for (const item of findings) {
    const exception = findStructuredException(exceptions, item);
    if (exception) approved.push({ ...item, exception });
    else violations.push(item);
  }
  return { approved, violations };
}

export function buildDependencyPolicyAiInstructions(violations) {
  const lines = ['依赖治理门禁失败，可将以下指令分别交给 AI 修复：'];
  violations.forEach((violation, index) => {
    lines.push(
      '',
      `${index + 1}. 请修复 ${violation.path} 第 ${violation.line} 行第 ${violation.column} 列的依赖问题。`,
      `   规则：${violation.rule}`,
      `   问题：${violation.message}`,
      '   修复要求：使用项目 npm 命令更新 package.json 与 package-lock.json，保持依赖分组、版本来源和锁文件根声明一致。',
      '   禁止绕过：不得删除锁文件、改用浮动版本或未批准来源，不得关闭门禁、扩大允许协议，或新增、延期、修改结构化例外。',
      '   验证要求：运行 npm install --package-lock-only、repo-guard dependencies，以及项目已有的测试和生产构建。',
    );
  });
  lines.push('', `共 ${violations.length} 个依赖治理问题，提交已停止。`);
  return lines.join('\n');
}

export function inspectStagedDependencyPolicy({ root, config, exceptions }) {
  const packageResult = runGit(['show', ':package.json'], {
    allowFailure: true,
    cwd: root,
  });
  if (packageResult.status !== 0) {
    return { approved: [], violations: [{
      line: 1,
      column: 1,
      message: 'The root package.json cannot be deleted or omitted',
      path: 'package.json',
      rule: 'dependencies/missing-manifest',
    }] };
  }

  const snapshotRoot = mkdtempSync(path.join(tmpdir(), 'repo-guard-dependencies-'));
  try {
    writeFileSync(path.join(snapshotRoot, 'package.json'), packageResult.stdout, 'utf8');
    const lockResult = runGit(['show', ':package-lock.json'], {
      allowFailure: true,
      cwd: root,
    });
    if (lockResult.status === 0) {
      writeFileSync(path.join(snapshotRoot, 'package-lock.json'), lockResult.stdout, 'utf8');
    }
    return inspectDependencyPolicy({
      root: snapshotRoot,
      config,
      exceptions,
    });
  } finally {
    rmSync(snapshotRoot, { recursive: true, force: true });
  }
}
