import {
  assertKnownProperties,
  configValidationError,
  normalizeRelativePattern,
} from "./validation-primitives.js";
import { JAVA_ENGINEERING_SCHEMA_PROPERTIES } from "./java-engineering-schema.js";

const common = Object.freeze({
  enabled: false,
  timeoutMs: 180000,
  executable: "mvn",
  pom: "pom.xml",
  offline: true,
  arguments: [],
  modules: [],
});
export const JAVA_ENGINEERING_DEFAULTS = Object.freeze({
  javaArchitecture: Object.freeze({ ...common }),
  javaDependencies: Object.freeze({
    ...common,
    enforcerExecution: "",
    requiredEnforcerRules: ["dependencyConvergence"],
    bannedDependencies: [],
    banSnapshots: true,
  }),
  javaFiles: Object.freeze({
    enabled: false,
    forbidden: ["**/target/**", "**/*.class", "**/*.jar"],
    allowedJavaRoots: [
      "src/main/java/**",
      "src/test/java/**",
      "**/src/main/java/**",
      "**/src/test/java/**",
    ],
  }),
  javaCompile: Object.freeze({ ...common }),
  javaBuild: Object.freeze({ ...common }),
  javaTest: Object.freeze({ ...common }),
  javaCoverage: Object.freeze({
    ...common,
    thresholds: { line: 80, branch: 80, instruction: 80 },
  }),
});

function fail(label, message) {
  throw configValidationError(`${label} ${message}`);
}
function strings(value, label, { empty = false, paths = false } = {}) {
  if (
    !Array.isArray(value) ||
    (!empty && !value.length) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  )
    fail(label, "必须是非空字符串数组");
  if (new Set(value).size !== value.length) fail(label, "不得包含重复值");
  return value.map((item) =>
    paths ? normalizeRelativePattern(item, label) : item.trim(),
  );
}
function exactPath(value, label) {
  const result = normalizeRelativePattern(value, label);
  if (/[*?{}[\]]/.test(result) || result.includes("\0"))
    fail(label, "必须是具体路径，不支持通配符");
  return result;
}
function normalizeModules(value, key, enabled, label) {
  if (!Array.isArray(value) || (enabled && !value.length))
    fail(`${label}.modules`, "启用时必须显式声明必需模块");
  const spec = JAVA_ENGINEERING_SCHEMA_PROPERTIES[key].properties.modules.items;
  const modules = value.map((item, index) => {
    const prefix = `${label}.modules[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item))
      fail(prefix, "必须是对象");
    assertKnownProperties(item, new Set(Object.keys(spec.properties)), prefix);
    if (typeof item.name !== "string" || !item.name.trim())
      fail(prefix, "必须提供模块名称");
    const result = {
      name: item.name.trim(),
      directory: exactPath(item.directory ?? ".", `${prefix}.directory`),
    };
    for (const field of spec.required.filter((name) => name !== "name")) {
      result[field] = ["reports", "outputs", "requiredTestClasses"].includes(
        field,
      )
        ? strings(item[field], `${prefix}.${field}`).map((entry) =>
            field === "requiredTestClasses"
              ? entry
              : exactPath(entry, `${prefix}.${field}`),
          )
        : exactPath(item[field], `${prefix}.${field}`);
    }
    if (
      result.outputs?.some((entry) =>
        key === "javaCompile"
          ? !entry.endsWith(".class")
          : !/\.(jar|war|ear)$/.test(entry),
      )
    )
      fail(prefix, "必须声明实际 .class 或 Java 构建产物文件");
    return result;
  });
  if (new Set(modules.map(({ name }) => name)).size !== modules.length)
    fail(label, "模块名称不得重复");
  if (
    new Set(modules.map(({ directory }) => directory)).size !== modules.length
  )
    fail(label, "必需模块必须声明不同的项目目录");
  const evidencePaths = modules.flatMap((module) => {
    const paths = [
      ...(module.reports ?? []),
      ...(module.outputs ?? []),
      ...[
        module.coverageReport,
        module.effectivePom,
        module.dependencyTree,
      ].filter(Boolean),
    ];
    if (
      module.directory !== "." &&
      paths.some((file) => !file.startsWith(`${module.directory}/`))
    )
      fail(label, "报告和产物必须位于所属模块目录中");
    return paths;
  });
  if (new Set(evidencePaths).size !== evidencePaths.length)
    fail(label, "必需模块不得复用同一报告或产物");
  return modules;
}
function normalizeCheck(key, value, configPath, featureName = key) {
  const label = `${configPath} checks.${featureName}`;
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(label, "必须是对象");
  assertKnownProperties(
    value,
    new Set(Object.keys(JAVA_ENGINEERING_SCHEMA_PROPERTIES[key].properties)),
    label,
  );
  const result = { ...JAVA_ENGINEERING_DEFAULTS[key], ...value };
  if (typeof result.enabled !== "boolean") fail(label, "enabled 必须是布尔值");
  if (key === "javaFiles")
    return {
      ...result,
      forbidden: strings(result.forbidden, `${label}.forbidden`, {
        empty: true,
        paths: true,
      }),
      allowedJavaRoots: strings(
        result.allowedJavaRoots,
        `${label}.allowedJavaRoots`,
        { paths: true },
      ),
    };
  if (
    !Number.isInteger(result.timeoutMs) ||
    result.timeoutMs < 1 ||
    result.timeoutMs > 2147483647
  )
    fail(`${label}.timeoutMs`, "必须介于 1 到 2147483647");
  if (typeof result.offline !== "boolean") fail(`${label}.offline`, "必须是布尔值");
  if (
    typeof result.executable !== "string" ||
    !result.executable.trim() ||
    /["%\r\n&|<>^!]/.test(result.executable)
  )
    fail(`${label}.executable`, "必须是安全的 Maven 可执行路径");
  if (/(?:^|[\\/])mvnw(?:\.(?:cmd|bat))?$/i.test(result.executable))
    fail(
      label,
      "本轮不执行 Maven Wrapper；请显式配置已准备好的对应版本 Maven，检查不会下载或替换工具",
    );
  result.pom = exactPath(result.pom, `${label}.pom`);
  result.arguments = strings(result.arguments, `${label}.arguments`, {
    empty: true,
  });
  if (
    result.arguments.some(
      (arg) =>
        !/^(?:-P[A-Za-z0-9_,.-]+|-D[A-Za-z0-9_.-]+=[A-Za-z0-9_.,:/@+-]+)$/.test(
          arg,
        ) ||
        (arg.startsWith("-D") &&
          /skip|output|report|test|fail|enforcer|jacoco|surefire|failsafe|maven\.main|compiler|packaging/i.test(
            arg.slice(2, arg.indexOf("=")),
          )),
    )
  )
    fail(
      label,
      "arguments 仅允许显式配置的 profile 和普通属性，禁止跳过、输出重定向及改变必需检查",
    );
  result.modules = normalizeModules(result.modules, key, result.enabled, label);
  if (key === "javaDependencies") {
    for (const module of result.modules) {
      const prefix = module.directory === "." ? "" : `${module.directory}/`;
      for (const [field, extension] of [
        ["effectivePom", ".xml"],
        ["dependencyTree", ".json"],
      ]) {
        if (
          ![`${prefix}target/`, `${prefix}reports/`].some((directory) =>
            module[field].startsWith(directory),
          ) ||
          !module[field].endsWith(extension)
        )
          fail(
            label,
            "依赖输出必须位于所属模块 target/ 或 reports/ 内，并使用 XML/JSON 对应扩展名",
          );
      }
    }
    if (result.enabled && !/^[A-Za-z0-9_.-]+$/.test(result.enforcerExecution))
      fail(label, "必须配置现有 Enforcer 执行标识");
    result.requiredEnforcerRules = strings(
      result.requiredEnforcerRules,
      `${label}.requiredEnforcerRules`,
    );
    const supportedRules = new Set([
      "dependencyConvergence",
      "requireUpperBoundDeps",
      "banDuplicatePomDependencyVersions",
      "bannedDependencies",
      "requireReleaseDeps",
      "requirePluginVersions",
      "bannedPlugins",
      "banDynamicVersions",
    ]);
    if (result.requiredEnforcerRules.some((rule) => !supportedRules.has(rule)))
      fail(label, "requiredEnforcerRules 包含不支持的依赖规则");
    result.bannedDependencies = strings(
      result.bannedDependencies,
      `${label}.bannedDependencies`,
      { empty: true },
    );
    if (typeof result.banSnapshots !== "boolean")
      fail(label, "banSnapshots 必须是布尔值");
  }
  if (key === "javaCoverage") {
    const thresholds = result.thresholds;
    if (
      !thresholds ||
      typeof thresholds !== "object" ||
      Array.isArray(thresholds)
    )
      fail(label, "thresholds 必须是对象");
    assertKnownProperties(
      thresholds,
      new Set(["line", "branch", "instruction"]),
      `${label}.thresholds`,
    );
    result.thresholds = {
      ...JAVA_ENGINEERING_DEFAULTS.javaCoverage.thresholds,
      ...thresholds,
    };
    if (
      Object.values(result.thresholds).some(
        (threshold) =>
          typeof threshold !== "number" ||
          !Number.isFinite(threshold) ||
          threshold < 0 ||
          threshold > 100,
      )
    )
      fail(label, "覆盖率阈值必须介于 0 到 100");
  }
  return result;
}
export function validateJavaEngineeringChecks(
  checks,
  { configPath = "repo-guard.config.json", featureNames = {} } = {},
) {
  return Object.fromEntries(
    Object.keys(JAVA_ENGINEERING_DEFAULTS).map((key) => [
      key,
      normalizeCheck(key, checks[key] ?? {}, configPath, featureNames[key] ?? key),
    ]),
  );
}
