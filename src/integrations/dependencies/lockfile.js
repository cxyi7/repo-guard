import npa from "npm-package-arg";
import {
  isExactRegistryVersion,
  isSpecialDependencyReference,
} from "./version.js";
import semver from "semver";
import YAML from "yaml";
import yarnLockfile from "@yarnpkg/lockfile";
import { configurationError } from "../../core/error/repo-guard-error.js";

const sections = ["dependencies", "devDependencies", "optionalDependencies"];
const issue = (file, dependency, message) => ({
  path: file,
  line: 1,
  column: 1,
  dependency,
  rule: "dependencies/lockfile-mismatch",
  message,
});
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function parse(source, manager, file) {
  try {
    if (manager === "npm") return JSON.parse(source);
    if (manager === "yarn" && !/^__metadata:/m.test(source)) {
      const parsed = yarnLockfile.parse(source);
      if (parsed.type !== "success")
        throw configurationError(
          "dependency-policy/lockfile-conflict",
          "锁文件包含冲突或不完整条目",
        );
      return { classic: true, entries: parsed.object };
    }
    return YAML.parse(source, { uniqueKeys: true, maxAliasCount: 100 });
  } catch (cause) {
    throw configurationError(
      "dependency-policy/lockfile-parse",
      `无法解析 ${file}，请使用所选包管理器生成有效锁文件`,
      { cause },
    );
  }
}
function effective(manifest) {
  const result = {};
  for (const section of sections) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (
        section === "dependencies" &&
        Object.hasOwn(manifest.optionalDependencies ?? {}, name)
      )
        continue;
      result[name] = { specifier, section };
    }
  }
  return result;
}
function validResolution(version, specifier) {
  if (!isExactRegistryVersion(version)) return false;
  if (semver.validRange(specifier)) return semver.satisfies(version, specifier);
  try {
    return npa.resolve("dependency", specifier).type === "tag";
  } catch {
    return false;
  }
}

/** 仅验证当前清单的普通直接依赖；不把存在锁文件当作安装证据。 */
export function inspectLockfile({
  source,
  manager,
  file,
  manifest,
  importer = ".",
}) {
  const lock = parse(source, manager, file);
  const invalid = () => {
    throw configurationError(
      "dependency-policy/unsupported-lockfile",
      `${file} 的格式不受当前适配器支持或缺少必需结构`,
    );
  };
  if (!object(lock)) invalid();
  const expected = effective(manifest);
  const findings = [];
  const add = (name, text) => findings.push(issue(file, name, text));
  if (manager === "npm" || manager === "pnpm") {
    if (
      manager === "npm" &&
      (![2, 3].includes(lock.lockfileVersion) || !object(lock.packages))
    )
      invalid();
    if (
      manager === "pnpm" &&
      (![6, 9].includes(Number(lock.lockfileVersion)) ||
        !object(lock.importers))
    )
      invalid();
    const root =
      manager === "npm"
        ? lock.packages[importer === "." ? "" : importer]
        : lock.importers[importer];
    if (!object(root))
      return [issue(file, null, `锁文件缺少应用 ${importer} 对应的清单记录`)];
    const actual = effective(root);
    for (const name of new Set([
      ...Object.keys(expected),
      ...Object.keys(actual),
    ])) {
      const wanted = expected[name];
      const stored = actual[name];
      const specifier =
        manager === "npm" ? stored?.specifier : stored?.specifier?.specifier;
      if (
        isSpecialDependencyReference(
          name,
          wanted ? wanted.specifier : specifier,
        )
      )
        continue;
      if (
        !wanted ||
        !stored ||
        wanted.section !== stored.section ||
        wanted.specifier !== specifier
      ) {
        add(name, `${name} 的锁文件声明或依赖分组与 package.json 不一致`);
        continue;
      }
      let record;
      let version;
      if (manager === "npm") {
        const parts = importer === "." ? [] : importer.split("/");
        for (let depth = parts.length; depth >= 0; depth -= 1) {
          const key = [...parts.slice(0, depth), "node_modules", name].join(
            "/",
          );
          if (Object.hasOwn(lock.packages, key)) {
            record = lock.packages[key];
            break;
          }
        }
        version = record?.version;
      } else {
        const reference = stored.specifier.version;
        version =
          typeof reference === "string" ? reference.split("(")[0] : null;
        const key = `${name}@${version}`;
        const peerKey = `${key}${typeof reference === "string" ? reference.slice(version.length) : ""}`;
        record =
          lock.packages?.[key] ??
          lock.packages?.[`/${key}`] ??
          lock.packages?.[peerKey] ??
          lock.packages?.[`/${peerKey}`];
      }
      if (!record || !validResolution(version, wanted.specifier))
        add(name, `${name} 缺少有效的锁定版本记录，或锁定版本不满足清单声明`);
    }
  } else {
    if (
      !lock.classic &&
      (!object(lock.__metadata) ||
        ![4, 5, 6, 7, 8, 9, 10].includes(lock.__metadata.version))
    )
      invalid();
    const entries = lock.classic ? lock.entries : lock;
    const descriptors = new Map();
    for (const [keys, record] of Object.entries(entries)) {
      if (keys === "__metadata") continue;
      for (const key of keys.split(/,\s+/)) {
        if (descriptors.has(key)) invalid();
        descriptors.set(key, record);
      }
    }
    for (const [name, { specifier }] of Object.entries(expected)) {
      if (isSpecialDependencyReference(name, specifier)) continue;
      const record = descriptors.get(
        `${name}@${lock.classic ? "" : "npm:"}${specifier}`,
      );
      if (!record || !validResolution(record.version, specifier))
        add(name, `${name} 缺少匹配声明的 Yarn 锁定版本记录`);
    }
  }
  return findings;
}
