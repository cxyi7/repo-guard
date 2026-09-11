import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateJavaEngineeringChecks } from "../../../src/config/java-engineering.js";
import {
  runJavaEngineeringGate,
  javaEngineeringGates,
} from "../../../src/gates/java/engineering-gates.js";
import { evaluateJavaEngineering } from "../../../src/policies/java/engineering/evaluate.js";
import { gateResultToExitCode } from "../../../src/core/result/exit-code.js";

function testConfig(key = "javaTest", extra = {}) {
  return validateJavaEngineeringChecks({
    [key]: {
      enabled: true,
      modules: [{ name: "app", reports: ["target/TEST-app.xml"], ...extra }],
    },
  })[key];
}
function facts(module, status = 0) {
  return {
    startedAt: 100,
    modules: [module],
    executions: [{ status, stdout: "", stderr: "", goals: ["verify"] }],
  };
}
test("七项 Java 门禁独立注册且仅文件门禁进入提交阶段", () => {
  assert.equal(javaEngineeringGates.length, 7);
  assert.deepEqual(
    javaEngineeringGates
      .filter((gate) => gate.environments.includes("pre-commit"))
      .map((gate) => gate.id),
    ["java.files"],
  );
  assert.ok(
    javaEngineeringGates.every((gate) =>
      gate.configKey.startsWith("checks.java"),
    ),
  );
});
test("空测试、全部跳过和必需架构类未执行都阻断", () => {
  const empty = { name: "app", executed: 0, failed: 0, cases: [] };
  assert.ok(
    evaluateJavaEngineering("javaTest", facts(empty), testConfig()).some(
      (finding) => finding.ruleId === "java/tests-not-executed",
    ),
  );
  const architecture = testConfig("javaArchitecture", {
    requiredTestClasses: ["app.ArchitectureTest"],
  });
  const module = {
    ...empty,
    executed: 1,
    cases: [{ classname: "app.OtherTest", skipped: false }],
    requiredTestClasses: ["app.ArchitectureTest"],
  };
  assert.ok(
    evaluateJavaEngineering(
      "javaArchitecture",
      facts(module),
      architecture,
    ).some((finding) => finding.ruleId === "java/architecture-not-executed"),
  );
});
test("每个模块独立执行且覆盖率阈值不能被平均数掩盖", () => {
  const config = testConfig("javaCoverage", {
    coverageReport: "target/jacoco.xml",
  });
  const module = {
    name: "app",
    executed: 1,
    failed: 0,
    coverageReport: "target/jacoco.xml",
    coverage: {
      sessions: [{ start: 100, dump: 200 }],
      counters: {
        line: { covered: 1, missed: 9 },
        branch: { covered: 0, missed: 0 },
        instruction: { covered: 90, missed: 10 },
      },
    },
  };
  assert.ok(
    evaluateJavaEngineering("javaCoverage", facts(module), config).some(
      (finding) => finding.ruleId === "java/coverage-threshold",
    ),
  );
  assert.throws(
    () =>
      evaluateJavaEngineering(
        "javaCoverage",
        { ...facts(module), startedAt: 150 },
        config,
      ),
    (error) => error.kind === "execution",
  );
});
test("原生测试失败映射违规，未知工具失败映射执行错误", async () => {
  const config = testConfig();
  const failed = await runJavaEngineeringGate({
    root: ".",
    key: "javaTest",
    config,
    collect: async () => facts({ name: "app", executed: 1, failed: 1 }, 1),
  });
  assert.equal(failed.status, "violation");
  assert.equal(gateResultToExitCode(failed), 2);
  const error = await runJavaEngineeringGate({
    root: ".",
    key: "javaTest",
    config,
    collect: async () => facts({ name: "app", executed: 1, failed: 0 }, 7),
  });
  assert.equal(error.status, "execution-error");
  assert.equal(gateResultToExitCode(error), 1);
  const unknownWithFailedTest = await runJavaEngineeringGate({
    root: ".",
    key: "javaTest",
    config,
    collect: async () => facts({ name: "app", executed: 1, failed: 1 }, 7),
  });
  assert.equal(unknownWithFailedTest.status, "execution-error");
});
test("原生路径规则只约束文件位置且不执行 Maven", async () => {
  const config = validateJavaEngineeringChecks({
    javaFiles: { enabled: true },
  }).javaFiles;
  const result = await runJavaEngineeringGate({
    root: ".",
    key: "javaFiles",
    config,
    files: [
      "module/target/App.class",
      "other/App.java",
      "module/src/main/java/app/App.java",
    ],
  });
  assert.equal(result.findings.length, 2);
  assert.equal(result.status, "violation");
});
test("注册门禁遵循 CI 强制计划，并对空上下文读取完整 index", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-java-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.mkdirSync(path.join(root, "target"));
  fs.writeFileSync(path.join(root, "target/App.class"), "构建产物");
  execFileSync("git", ["add", "target/App.class"], { cwd: root });
  const gate = javaEngineeringGates.find((item) => item.id === "java.files");
  const config = { checks: validateJavaEngineeringChecks({}) };
  for (const environment of [
    "manual",
    "pre-commit",
    "pre-push",
    "ci-policy",
    "ci-full",
    "release-ready",
  ]) {
    const result = await gate.run({
      root,
      config,
      plan: { enabled: true },
      files: [],
      environment,
    });
    assert.equal(result.status, "violation", environment);
    assert.equal(result.findings[0].location.path, "target/App.class");
  }
});
test("CI 强制启用未配置模块的检查时先报告配置错误", async () => {
  const gate = javaEngineeringGates.find((item) => item.id === "java.test");
  const config = { checks: validateJavaEngineeringChecks({}) };
  config.checks.javaTest = { ...config.checks.javaTest, enabled: true };
  assert.throws(
    () => gate.inspectSetup({ root: ".", config }),
    (error) => error.kind === "configuration",
  );
  const result = await gate.run({
    root: ".",
    config,
    plan: { enabled: true },
    environment: "ci-full",
    files: [],
  });
  assert.equal(result.status, "configuration-error");
});
test("禁用或不可解析的 Enforcer 控制项不能作为通过证据", () => {
  const config = validateJavaEngineeringChecks({
    javaDependencies: {
      enabled: true,
      enforcerExecution: "deps",
      modules: [
        {
          name: "app",
          effectivePom: "target/effective.xml",
          dependencyTree: "target/tree.json",
        },
      ],
    },
  }).javaDependencies;
  const effective = {
    groupId: "a",
    artifactId: "app",
    version: "1",
    enforcerConfigured: true,
    enforcerVersion: "3.5.0",
    rules: ["dependencyConvergence"],
    ruleLevels: { dependencyConvergence: "ERROR" },
    skip: false,
    fail: true,
  };
  for (const override of [
    { skip: true },
    { skip: null },
    { fail: false },
    { fail: null },
    { selectiveRules: true },
    { ruleLevels: { dependencyConvergence: "WARN" } },
  ]) {
    const module = {
      name: "app",
      effective: { ...effective, ...override },
      tree: {
        root: { groupId: "a", artifactId: "app", version: "1" },
        dependencies: [],
      },
    };
    assert.throws(
      () => evaluateJavaEngineering("javaDependencies", facts(module), config),
      (error) => error.kind === "configuration",
    );
  }
  const module = {
    name: "app",
    effective,
    enforcer: { status: 0, events: [] },
    tree: {
      root: { groupId: "a", artifactId: "app", version: "1" },
      dependencies: [],
    },
  };
  assert.throws(
    () => evaluateJavaEngineering("javaDependencies", facts(module), config),
    (error) =>
      error.kind === "execution" &&
      error.code === "java/enforcer-rule-not-executed",
  );
  module.enforcer.events = [
    { rule: "dependencyConvergence", outcome: "warned" },
  ];
  assert.ok(
    evaluateJavaEngineering("javaDependencies", facts(module), config).some(
      (finding) => finding.ruleId === "java/dependency-enforcer",
    ),
  );
  module.enforcer.events = [
    { rule: "dependencyConvergence", outcome: "passed" },
  ];
  assert.deepEqual(
    evaluateJavaEngineering("javaDependencies", facts(module), config),
    [],
  );
});
