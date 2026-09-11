const relativePath = {
  type: "string",
  minLength: 1,
  pattern: "^(?!/|[A-Za-z]:|.*(?:^|/)\\.\\.(?:/|$)).+$",
};
const strings = {
  type: "array",
  items: { type: "string", minLength: 1 },
  uniqueItems: true,
};
const paths = { type: "array", items: relativePath, uniqueItems: true };
const moduleProperties = {
  name: { type: "string", minLength: 1, description: "应用内唯一的稳定模块名称，用于问题归属和问题标识；名称改变会改变对应问题标识。" },
  directory: relativePath,
  reports: { ...paths, minItems: 1, description: "相对应用根目录的必需原生报告；报告不得跨模块复用，失败问题保留报告位置和用例证据。" },
  outputs: { ...paths, minItems: 1 },
  coverageReport: relativePath,
  requiredTestClasses: { ...strings, minItems: 1 },
  effectivePom: relativePath,
  dependencyTree: relativePath,
};
const fields = {
  javaArchitecture: ["reports", "requiredTestClasses"],
  javaDependencies: ["effectivePom", "dependencyTree"],
  javaCompile: ["outputs"],
  javaBuild: ["outputs"],
  javaTest: ["reports"],
  javaCoverage: ["reports", "coverageReport"],
};
const common = {
  enabled: { type: "boolean", default: false },
  timeoutMs: { type: "integer", minimum: 1, maximum: 2147483647 },
  executable: { type: "string", minLength: 1 },
  pom: relativePath,
  offline: { type: "boolean" },
  arguments: strings,
};
export const JAVA_ENGINEERING_SCHEMA_PROPERTIES = Object.fromEntries([
  ...Object.entries(fields).map(([key, names]) => [
    key,
    {
      type: "object",
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: { enabled: { const: true } },
            required: ["enabled"],
          },
          then: {
            required: [
              "modules",
              ...(key === "javaDependencies" ? ["enforcerExecution"] : []),
            ],
            properties: {
              modules: { type: "array", minItems: 1 },
              ...(key === "javaDependencies"
                ? { enforcerExecution: { type: "string", minLength: 1 } }
                : {}),
            },
          },
        },
      ],
      properties: {
        ...common,
        modules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              ["name", "directory", ...names].map((name) => [
                name,
                moduleProperties[name],
              ]),
            ),
            required: ["name", ...names],
          },
        },
        ...(key === "javaDependencies"
          ? {
              enforcerExecution: { type: "string" },
              requiredEnforcerRules: {
                ...strings,
                minItems: 1,
                items: {
                  enum: [
                    "dependencyConvergence",
                    "requireUpperBoundDeps",
                    "banDuplicatePomDependencyVersions",
                    "bannedDependencies",
                    "requireReleaseDeps",
                    "requirePluginVersions",
                    "bannedPlugins",
                    "banDynamicVersions",
                  ],
                },
              },
              bannedDependencies: strings,
              banSnapshots: { type: "boolean" },
            }
          : {}),
        ...(key === "javaCoverage"
          ? {
              thresholds: {
                type: "object",
                additionalProperties: false,
                properties: Object.fromEntries(
                  ["line", "branch", "instruction"].map((name) => [
                    name,
                    { type: "number", minimum: 0, maximum: 100 },
                  ]),
                ),
              },
            }
          : {}),
      },
    },
  ]),
  [
    "javaFiles",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: common.enabled,
        forbidden: paths,
        allowedJavaRoots: { ...paths, minItems: 1 },
      },
    },
  ],
]);
