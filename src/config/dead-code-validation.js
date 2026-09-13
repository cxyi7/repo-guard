import {
  DEFAULT_DEAD_CODE_CONFIG,
  SUPPORTED_DEAD_CODE_ISSUE_TYPES,
} from "./defaults.js";
import {
  assertKnownProperties,
  configValidationError,
  normalizeRelativePattern,
} from "./validation-primitives.js";

function validateOptions(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw configValidationError(label + " 必须为 JSON 对象");
  const visit = (item) => {
    if (
      item === null ||
      ["string", "boolean"].includes(typeof item) ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype
    ) {
      for (const [key, child] of Object.entries(item)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw configValidationError(label + " 包含不允许的属性");
        visit(child);
      }
      return;
    }
    throw configValidationError(label + " 只接受 JSON 值");
  };
  visit(value);
  return structuredClone(value);
}

const MODES = Object.freeze(["strict", "noRegression"]);

export function validateDeadCodeConfiguration(value, configPath) {
  const candidate = value.deadCode ?? {};
  const label = `${configPath} checks.deadCode`;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    candidate,
    new Set([
      "enabled",
      "options",
      "mode",
      "configFile",
      "baselineFile",
      "timeoutMs",
      "production",
      "issueTypes",
      "treatConfigHintsAsErrors",
    ]),
    label,
  );
  for (const property of [
    "enabled",
    "production",
    "treatConfigHintsAsErrors",
  ]) {
    if (
      candidate[property] != null &&
      typeof candidate[property] !== "boolean"
    ) {
      throw configValidationError(`${label}.${property} 必须是布尔值`);
    }
  }
  if (candidate.treatConfigHintsAsErrors === false) {
    throw configValidationError(
      `${label}.treatConfigHintsAsErrors 必须为 true`,
    );
  }
  const mode = candidate.mode ?? DEFAULT_DEAD_CODE_CONFIG.mode;
  if (!MODES.includes(mode)) {
    throw configValidationError(`${label}.mode 必须为 strict 或 noRegression`);
  }
  if (
    candidate.timeoutMs != null &&
    (!Number.isInteger(candidate.timeoutMs) || candidate.timeoutMs < 1)
  ) {
    throw configValidationError(`${label}.timeoutMs 必须是正整数`);
  }
  let configFile = candidate.configFile ?? DEFAULT_DEAD_CODE_CONFIG.configFile;
  if (configFile != null) {
    configFile = normalizeRelativePattern(configFile, `${label}.configFile`);
  }
  const baselineFile = normalizeRelativePattern(
    candidate.baselineFile ?? DEFAULT_DEAD_CODE_CONFIG.baselineFile,
    `${label}.baselineFile`,
  );
  const issueTypes =
    candidate.issueTypes ?? DEFAULT_DEAD_CODE_CONFIG.issueTypes;
  if (
    !Array.isArray(issueTypes) ||
    issueTypes.length === 0 ||
    issueTypes.some((item) => !SUPPORTED_DEAD_CODE_ISSUE_TYPES.includes(item))
  ) {
    throw configValidationError(
      `${label}.issueTypes 必须是受支持问题类型组成的非空数组`,
    );
  }
  if (new Set(issueTypes).size !== issueTypes.length) {
    throw configValidationError(`${label}.issueTypes 不得包含重复值`);
  }
  const normalizedIssueTypes = SUPPORTED_DEAD_CODE_ISSUE_TYPES.filter((item) =>
    issueTypes.includes(item),
  );
  return {
    ...(candidate.options !== undefined
      ? { options: validateOptions(candidate.options, label + ".options") }
      : {}),
    enabled: candidate.enabled ?? DEFAULT_DEAD_CODE_CONFIG.enabled,
    mode,
    configFile,
    baselineFile,
    timeoutMs: candidate.timeoutMs ?? DEFAULT_DEAD_CODE_CONFIG.timeoutMs,
    production: candidate.production ?? DEFAULT_DEAD_CODE_CONFIG.production,
    issueTypes: normalizedIssueTypes,
    treatConfigHintsAsErrors:
      candidate.treatConfigHintsAsErrors ??
      DEFAULT_DEAD_CODE_CONFIG.treatConfigHintsAsErrors,
  };
}
