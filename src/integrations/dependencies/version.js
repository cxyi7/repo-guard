import npa from "npm-package-arg";
import semver from "semver";

export function isExactRegistryVersion(value) {
  if (typeof value !== "string") return false;
  const parsed = semver.parse(value, { loose: false });
  if (!parsed) return false;
  const canonical =
    parsed.version + (parsed.build.length ? `+${parsed.build.join(".")}` : "");
  return canonical === value;
}

/** 特殊引用不参与普通依赖策略；无法解析的普通版本仍交给声明校验。 */
export function isSpecialDependencyReference(name, value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return !["version", "range", "tag"].includes(npa.resolve(name, value).type);
  } catch {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value.trim());
  }
}
