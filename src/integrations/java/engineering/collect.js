import path from "node:path";
import {
  executionError,
  toRepoGuardError,
} from "../../../core/error/repo-guard-error.js";
import { executeMaven, inspectMavenTools } from "./process.js";
import { inspectMavenBoundary } from "./boundary.js";
import { inspectMavenImplicitConfiguration } from "./implicit-configuration.js";
import { javaFileStamp, javaOutputPaths, readFreshJavaFile, safeJavaPath } from "./files.js";
import {
  parseDependencyTree,
  parseEffectivePom,
  parseEnforcerRuleEvents,
  parseJacocoReport,
  parseJUnitReport,
} from "./reports.js";

export function inspectJavaEngineeringSetup(
  root,
  config,
  { verifyTools = true } = {},
) {
  inspectMavenImplicitConfiguration(root, config);
  if (verifyTools) inspectMavenTools(root, config);
  safeJavaPath(root, config.pom);
  for (const module of config.modules) {
    safeJavaPath(root, module.directory);
    safeJavaPath(
      root,
      module.directory === "."
        ? config.pom
        : path.posix.join(module.directory, "pom.xml"),
    );
    inspectMavenImplicitConfiguration(root, {
      ...config,
      pom: module.directory === "." ? config.pom : path.posix.join(module.directory, "pom.xml"),
    });
  }
  for (const file of javaOutputPaths(config))
    safeJavaPath(root, file, { required: false });
  inspectMavenBoundary(root, config);
  return { modules: config.modules.length };
}
function readOutput(root, file, freshness) {
  return readFreshJavaFile(
    root,
    file,
    freshness.startedAt,
    freshness.before[file],
  );
}
function junitFacts(root, module, freshness) {
  const reports = module.reports.map((file) => ({
    path: file,
    ...parseJUnitReport(readOutput(root, file, freshness)),
  }));
  const cases = reports.flatMap((report) => report.cases);
  const identities = cases.map((item) => `${item.classname}\0${item.name}`);
  if (new Set(identities).size !== identities.length)
    throw executionError(
      "java/duplicate-test-evidence",
      `模块 ${module.name} 的测试报告重复计数同一用例`,
    );
  return {
    ...module,
    reports,
    cases,
    total: cases.length,
    executed: cases.filter((item) => !item.skipped).length,
    failed: cases.filter((item) => item.failed).length,
  };
}
function artifactFacts(root, module, freshness) {
  return {
    ...module,
    outputs: module.outputs.map((file) => {
      const content = readFreshJavaFile(
        root,
        file,
        freshness.startedAt,
        freshness.before[file],
        { headerOnly: true },
      );
      const expected = file.endsWith(".class") ? "cafebabe" : "504b0304";
      if (content.subarray(0, 4).toString("hex") !== expected)
        throw executionError(
          "java/invalid-artifact",
          `Java 产物不是声明的二进制格式：${file}`,
        );
      return { path: file, bytes: javaFileStamp(root, file).size };
    }),
  };
}
function ordinaryGoals(key) {
  if (key === "javaCompile") return ["clean", "test-compile"];
  if (key === "javaBuild") return ["clean", "package"];
  return ["clean", "verify"];
}
async function dependencyFacts({ root, config, signal, execute, freshness }) {
  const modules = [];
  const executions = [];
  for (const module of config.modules) {
    const moduleConfig = {
      ...config,
      pom:
        module.directory === "."
          ? config.pom
          : path.posix.join(module.directory, "pom.xml"),
    };
    for (const [goals, additional] of [
      [
        ["clean", "help:effective-pom"],
        [
          `-Doutput=${safeJavaPath(root, module.effectivePom, { required: false })}`,
        ],
      ],
      [
        ["dependency:tree"],
        [
          "-DoutputType=json",
          `-DoutputFile=${safeJavaPath(root, module.dependencyTree, { required: false })}`,
        ],
      ],
      [
        [`enforcer:enforce@${config.enforcerExecution}`],
        ["-Denforcer.skip=false", "-Denforcer.fail=true"],
      ],
    ])
      executions.push(
        await execute({
          root,
          config: moduleConfig,
          goals,
          additional,
          signal,
        }),
      );
    modules.push({
      ...module,
      enforcer: {
        status: executions.at(-1).status,
        events: parseEnforcerRuleEvents(
          `${executions.at(-1).stdout ?? ""}\n${executions.at(-1).stderr ?? ""}`,
        ),
      },
      effective: parseEffectivePom(
        readOutput(root, module.effectivePom, freshness),
        config.enforcerExecution,
      ),
      tree: parseDependencyTree(
        readOutput(root, module.dependencyTree, freshness),
      ),
    });
  }
  return { modules, executions };
}

export async function collectJavaEngineeringFacts({
  root,
  key,
  config,
  signal,
  execute = executeMaven,
}) {
  inspectJavaEngineeringSetup(root, config, {
    verifyTools: execute === executeMaven,
  });
  const freshness = {
    before: Object.fromEntries(
      javaOutputPaths(config).map((file) => [file, javaFileStamp(root, file)]),
    ),
    startedAt: Date.now(),
  };
  const executions = [];
  const recordedExecute = async (input) => {
    const execution = await execute(input);
    executions.push(execution);
    return execution;
  };
  try {
    if (key === "javaDependencies")
      return {
        ...(await dependencyFacts({
          root,
          config,
          signal,
          execute: recordedExecute,
          freshness,
        })),
        startedAt: freshness.startedAt,
      };
    const execution = await recordedExecute({
      root,
      config,
      goals: ordinaryGoals(key),
      additional: [
        "-DskipTests=false",
        "-Dmaven.test.skip=false",
        "-DskipITs=false",
        "-Djacoco.skip=false",
      ],
      signal,
    });
    if (["javaCompile", "javaBuild"].includes(key) && execution.status !== 0)
      return { executions, modules: [], startedAt: freshness.startedAt };
    const modules = config.modules.map((module) => {
      if (["javaCompile", "javaBuild"].includes(key))
        return artifactFacts(root, module, freshness);
      const facts = junitFacts(root, module, freshness);
      return key === "javaCoverage"
        ? {
            ...facts,
            coverage: parseJacocoReport(
              readOutput(root, module.coverageReport, freshness),
            ),
          }
        : facts;
    });
    return { executions, modules, startedAt: freshness.startedAt };
  } catch (cause) {
    const error = toRepoGuardError(cause, {
      code: "java/collection-failed",
      message: "Java 工具证据采集失败",
    });
    error.javaExecutions = [...executions, ...(cause.javaExecutions ?? [])];
    throw toRepoGuardError(error);
  }
}
