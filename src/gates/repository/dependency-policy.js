import {
  isExactRegistryVersion,
  isSpecialDependencyReference,
} from "../../integrations/dependencies/version.js";
import { findStructuredException } from "../../policies/exception-registry.js";
import semver from "semver";

import { dependencyOptions } from "../../config/dependency-options.js";
import { dependencySnapshot } from "./dependency-snapshot.js";
import { inspectLockfile } from "../../integrations/dependencies/lockfile.js";

const DECLARATION_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

function skipJsonString(source, start) {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") cursor += 2;
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
        containerDepth === 1 &&
        JSON.parse(source.slice(cursor, stringEnd)) === property &&
        source[valueStart] === ":"
      ) {
        valueStart += 1;
        while (/\s/.test(source[valueStart])) valueStart += 1;
        if (source[valueStart] === "{") {
          let objectDepth = 1;
          let index = valueStart + 1;
          while (index < source.length && objectDepth > 0) {
            if (source[index] === '"') index = skipJsonString(source, index);
            else {
              if (source[index] === "{") objectDepth += 1;
              if (source[index] === "}") objectDepth -= 1;
              index += 1;
            }
          }
          return { end: index - 1, start: valueStart + 1 };
        }
      }
      cursor = stringEnd;
      continue;
    }
    if (source[cursor] === "{" || source[cursor] === "[") containerDepth += 1;
    if (source[cursor] === "}" || source[cursor] === "]") containerDepth -= 1;
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
        containerDepth === 1 &&
        JSON.parse(source.slice(cursor, stringEnd)) === property &&
        source[colon] === ":"
      )
        return cursor;
      cursor = stringEnd;
      continue;
    }
    if (source[cursor] === "{" || source[cursor] === "[") containerDepth += 1;
    if (source[cursor] === "}" || source[cursor] === "]") containerDepth -= 1;
    cursor += 1;
  }
  return -1;
}

function location(source, offset) {
  const before = source.slice(0, Math.max(0, offset));
  const lastNewline = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
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

function finding({ source, section, name, rule, message, specifier = null }) {
  return {
    ...declarationLocation(source, section, name),
    dependency: name,
    message,
    path: "package.json",
    rule,
    section,
    specifier,
  };
}

function inspectDeclarations(packageJson, source, config) {
  const findings = [];
  const sectionsByPackage = new Map();
  const banned = new Map(
    config.bannedPackages.map((item) => [item.name, item]),
  );

  for (const section of DECLARATION_SECTIONS) {
    const declarations = packageJson[section] ?? {};
    if (
      !declarations ||
      typeof declarations !== "object" ||
      Array.isArray(declarations)
    ) {
      findings.push({
        ...declarationLocation(source, section, section),
        message: `package.json ${section} 必须是对象`,
        path: "package.json",
        rule: "dependencies/invalid-declarations",
        section,
      });
      continue;
    }
    for (const [name, specifier] of Object.entries(declarations)) {
      if (isSpecialDependencyReference(name, specifier)) continue;
      const sections = sectionsByPackage.get(name) ?? [];
      sections.push(section);
      sectionsByPackage.set(name, sections);
      const ban = banned.get(name);
      if (ban) {
        findings.push(
          finding({
            source,
            section,
            name,
            rule: "dependencies/banned-package",
            message:
              `${name} 已被禁用： ${ban.reason}` +
              (ban.replacement ? `；请改用 ${ban.replacement}` : ""),
            specifier,
          }),
        );
      }
      if (typeof specifier !== "string" || !specifier.trim()) {
        findings.push(
          finding({
            source,
            section,
            name,
            rule: "dependencies/invalid-specifier",
            message: `${name} 必须使用非空字符串依赖说明符`,
            specifier,
          }),
        );
        continue;
      }
      if (section === "peerDependencies" && !semver.validRange(specifier)) {
        findings.push(
          finding({
            source,
            section,
            name,
            rule: "dependencies/invalid-peer-range",
            message: name + " 的 peerDependencies 必须使用合法版本范围",
            specifier,
          }),
        );
      } else if (
        section !== "peerDependencies" &&
        config.requireExactVersions &&
        !isExactRegistryVersion(specifier)
      ) {
        findings.push(
          finding({
            source,
            section,
            name,
            rule: "dependencies/non-exact-version",
            message:
              name +
              " 必须使用合法且规范的精确版本，不能使用范围、标签或不完整版本",
            specifier,
          }),
        );
      }
    }
  }

  for (const [name, sections] of sectionsByPackage) {
    if (!config.checkConflictingDeclarations) continue;
    const nonPeerSections = sections.filter(
      (section) =>
        section !== "peerDependencies" &&
        !(
          section === "dependencies" &&
          sections.includes("optionalDependencies")
        ),
    );
    if (
      nonPeerSections.length <= 1 ||
      new Set(nonPeerSections.map((section) => packageJson[section][name]))
        .size === 1
    )
      continue;
    findings.push(
      finding({
        source,
        section: nonPeerSections[0],
        name,
        rule: "dependencies/duplicate-declaration",
        message: `${name} 在多个依赖区段中重复声明： ${nonPeerSections.join(", ")}`,
      }),
    );
  }
  return findings;
}

function inspect({ root, config, exceptions, staged }) {
  const settings = {
    checkConflictingDeclarations: true,
    ...config,
    ...dependencyOptions(config, "repository.dependencyPolicy"),
  };
  const snapshot = dependencySnapshot(root, settings, staged);
  const { packageFile, rootManifest, read } = snapshot;
  let findings = inspectDeclarations(
    packageFile.value,
    packageFile.source,
    settings,
  );
  const add = (rule, message, file = "package.json") =>
    findings.push({ rule, message, path: file, line: 1, column: 1 });
  const declared = rootManifest.packageManager;
  const match =
    typeof declared === "string"
      ? /^(npm|pnpm|yarn)@([^+]+)(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/.exec(
          declared,
        )
      : null;
  if (
    settings.packageManager.requireVersionDeclaration &&
    (!match || semver.valid(match[2]) !== match[2])
  )
    add(
      "dependencies/package-manager-declaration",
      "安装根目录必须通过 packageManager 声明包管理器及精确版本",
    );
  if (declared && (!match || match[1] !== settings.packageManager.name))
    add(
      "dependencies/package-manager-mismatch",
      "packageManager 声明与 repo-guard 配置不一致",
    );
  if (settings.lockfile.checkConflictingLockfiles) {
    const candidates = [
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ];
    for (const file of candidates)
      if (file !== settings.lockfile.path && read(file) != null)
        add(
          "dependencies/conflicting-lockfile",
          "同一安装根目录存在未选中的锁文件：" + file,
          file,
        );
  }
  if (settings.requireLockfile) {
    const source = read(settings.lockfile.path);
    if (source == null)
      add(
        "dependencies/missing-lockfile",
        "缺少配置指定的锁文件：" + settings.lockfile.path,
      );
    else if (
      settings.lockfile.checkManifestSync &&
      !findings.some((item) =>
        [
          "dependencies/invalid-declarations",
          "dependencies/invalid-specifier",
        ].includes(item.rule),
      )
    )
      findings = findings.concat(
        inspectLockfile({
          source,
          manager: settings.packageManager.name,
          file: settings.lockfile.path,
          manifest: packageFile.value,
          importer: snapshot.importer,
        }),
      );
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

export function inspectDependencyPolicy(options) {
  return inspect({ ...options, staged: false });
}
export function inspectStagedDependencyPolicy(options) {
  return inspect({ ...options, staged: true });
}
