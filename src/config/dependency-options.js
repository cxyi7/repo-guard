import {
  assertKnownProperties,
  configValidationError,
} from "./validation-primitives.js";

import {
  DEPENDENCY_MANAGER_DEFAULTS,
  DEPENDENCY_LOCK_DEFAULTS,
  DEPENDENCY_TOOL_DEFAULTS,
} from "./defaults.js";

function group(value, defaults, label) {
  if (value === undefined) value = {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw configValidationError(`${label} 必须为对象`);
  assertKnownProperties(value, new Set(Object.keys(defaults)), label);
  const result = { ...defaults, ...value };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === "boolean" && typeof result[key] !== "boolean")
      throw configValidationError(`${label}.${key} 必须为布尔值`);
  }
  return result;
}

export function dependencyOptions(value, label) {
  const packageManager = group(
    value.packageManager,
    DEPENDENCY_MANAGER_DEFAULTS,
    `${label}.packageManager`,
  );
  if (!["npm", "pnpm", "yarn"].includes(packageManager.name))
    throw configValidationError(
      `${label}.packageManager.name 必须为 npm、pnpm 或 yarn`,
    );
  if (
    typeof packageManager.root !== "string" ||
    !packageManager.root.trim() ||
    /^(?:[A-Za-z]:|[\\/])/.test(packageManager.root) ||
    packageManager.root.includes("\\") ||
    packageManager.root.includes("\0")
  )
    throw configValidationError(
      `${label}.packageManager.root 必须为使用正斜杠的相对目录`,
    );
  const lockfile = group(
    value.lockfile,
    DEPENDENCY_LOCK_DEFAULTS,
    `${label}.lockfile`,
  );
  if (
    value.lockfile &&
    Object.hasOwn(value.lockfile, "path") &&
    typeof value.lockfile.path !== "string"
  )
    throw configValidationError(`${label}.lockfile.path 必须为字符串`);
  lockfile.path ??= {
    npm: "package-lock.json",
    pnpm: "pnpm-lock.yaml",
    yarn: "yarn.lock",
  }[packageManager.name];
  if (
    typeof lockfile.path !== "string" ||
    !lockfile.path ||
    /^(?:[A-Za-z]:|[\\/])/.test(lockfile.path) ||
    lockfile.path.includes("\\") ||
    lockfile.path.split("/").includes("..") ||
    lockfile.path.includes("\0")
  )
    throw configValidationError(`${label}.lockfile.path 必须位于安装根目录内`);
  return {
    packageManager,
    lockfile,
    toolReadiness: group(
      value.toolReadiness,
      DEPENDENCY_TOOL_DEFAULTS,
      `${label}.toolReadiness`,
    ),
  };
}
