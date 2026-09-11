import {
  assertKnownProperties,
  configValidationError,
} from "./validation-primitives.js";
import { JAVA_PATH_NAMING_CONVENTIONS } from "./java-path-naming-schema.js";

export { JAVA_PATH_NAMING_SCHEMA_PROPERTIES } from "./java-path-naming-schema.js";

const defaults = Object.freeze({
  enabled: false,
  include: Object.freeze(["**/src/main/java/**", "**/src/test/java/**"]),
  exclude: Object.freeze([]),
  rules: Object.freeze([
    Object.freeze({
      id: "java-files",
      target: "files",
      include: Object.freeze(["**/*.java"]),
      exclude: Object.freeze(["**/package-info.java", "**/module-info.java"]),
      conventions: Object.freeze(["PascalCase"]),
      basename: Object.freeze([]),
    }),
    Object.freeze({
      id: "java-packages",
      target: "directories",
      include: Object.freeze(["**"]),
      exclude: Object.freeze([]),
      conventions: Object.freeze(["lowercase"]),
      basename: Object.freeze([]),
    }),
  ]),
});
export const JAVA_PATH_NAMING_DEFAULTS = Object.freeze({
  javaPathNaming: defaults,
});

function reject(label, message) {
  throw configValidationError(`${label} ${message}`);
}
function object(value, label, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject(label, "必须是对象");
  assertKnownProperties(value, new Set(fields), label);
}
function patterns(value, label, { empty = true, basename = false } = {}) {
  if (!Array.isArray(value) || value.length > 64 || (!empty && !value.length)) {
    reject(label, `必须是${empty ? "最多" : "包含 1 至"} 64 项的数组`);
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 256)
      reject(label, "每项必须是 1 至 256 字符的简单路径通配符");
    if (item !== item.trim()) reject(label, "通配符首尾不得含空白");
    if (
      [...item].some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          ":\\[]{}()!|^$+".includes(character),
      )
    )
      reject(
        label,
        "只接受普通字符、*、? 和独立路径段 **，路径使用 /，不支持正则表达式",
      );
    const segments = item.split("/");
    if (
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      )
    )
      reject(label, "必须是应用内的相对路径，不得含空路径段、. 或 ..");
    if (segments.some((segment) => segment.includes("**") && segment !== "**"))
      reject(label, "** 必须独立占用一个路径段");
    if (basename && (segments.length !== 1 || item.includes("**")))
      reject(label, "只能匹配单个文件或目录名称，不得包含路径或 **");
    return item;
  });
  if (new Set(normalized).size !== normalized.length)
    reject(label, "不得包含重复项");
  return normalized;
}
function rule(value, index, label) {
  const location = `${label}.rules[${index}]`;
  object(value, location, [
    "id",
    "target",
    "include",
    "exclude",
    "conventions",
    "basename",
  ]);
  if (typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.id))
    reject(
      `${location}.id`,
      "必须以小写英文字母开头，只含小写字母、数字和连字符，长度为 1 至 64",
    );
  if (!["files", "directories"].includes(value.target))
    reject(`${location}.target`, "必须为 files 或 directories");
  const conventions = value.conventions === undefined ? [] : value.conventions;
  if (
    !Array.isArray(conventions) ||
    conventions.some((item) => !JAVA_PATH_NAMING_CONVENTIONS.includes(item)) ||
    new Set(conventions).size !== conventions.length
  ) {
    reject(
      `${location}.conventions`,
      `必须是不重复的命名约定数组，可填 ${JAVA_PATH_NAMING_CONVENTIONS.join("、")}`,
    );
  }
  const basename = patterns(
    value.basename === undefined ? [] : value.basename,
    `${location}.basename`,
    { basename: true },
  );
  if (!conventions.length && !basename.length)
    reject(location, "必须至少配置一项 conventions 或 basename 命名约束");
  return {
    id: value.id,
    target: value.target,
    include: patterns(value.include, `${location}.include`, { empty: false }),
    exclude: patterns(
      value.exclude === undefined
        ? value.target === "files"
          ? defaults.rules[0].exclude
          : []
        : value.exclude,
      `${location}.exclude`,
    ),
    conventions: [...conventions],
    basename,
  };
}

/** 返回独立的 Java 路径命名配置；不读取项目文件或修改传入对象。 */
export function validateJavaPathNamingChecks(
  checks = {},
  { configPath = "repo-guard.config.json" } = {},
) {
  const label = `${configPath} checks.javaPathNaming`;
  if (!checks || typeof checks !== "object" || Array.isArray(checks))
    reject(`${configPath} checks`, "必须是对象");
  const value =
    checks.javaPathNaming === undefined ? {} : checks.javaPathNaming;
  object(value, label, ["enabled", "include", "exclude", "rules"]);
  const enabled =
    value.enabled === undefined ? defaults.enabled : value.enabled;
  if (typeof enabled !== "boolean") reject(`${label}.enabled`, "必须为布尔值");
  const rules = value.rules === undefined ? defaults.rules : value.rules;
  if (!Array.isArray(rules) || !rules.length || rules.length > 64)
    reject(`${label}.rules`, "必须是包含 1 至 64 项规则的数组");
  const normalizedRules = rules.map((item, index) => rule(item, index, label));
  if (
    new Set(normalizedRules.map((item) => item.id)).size !==
    normalizedRules.length
  )
    reject(`${label}.rules`, "规则 id 不得重复");
  return {
    javaPathNaming: {
      enabled,
      include: patterns(
        value.include === undefined ? defaults.include : value.include,
        `${label}.include`,
        { empty: false },
      ),
      exclude: patterns(
        value.exclude === undefined ? defaults.exclude : value.exclude,
        `${label}.exclude`,
      ),
      rules: normalizedRules,
    },
  };
}
