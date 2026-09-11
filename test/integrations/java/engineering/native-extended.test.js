import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateJavaEngineeringChecks } from "../../../../src/config/java-engineering.js";
import { runJavaEngineeringGate } from "../../../../src/gates/java/engineering-gates.js";
import { writeExtendedFixture, extendedPom } from "./native-fixture.js";

test(
  "真实 ArchUnit 越层失败及 JaCoCo 成功、阈值失败和缺数据阻断",
  {
    skip: process.env.REPO_GUARD_JAVA_NATIVE_EXTENDED !== "1",
    timeout: 240000,
  },
  async (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "repo guard java extended "),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    writeExtendedFixture(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "pom.xml", "src"], { cwd: root });
    const common = {
      enabled: true,
      timeoutMs: 90000,
      arguments: [
        `-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_MAVEN_REPOSITORY.replaceAll("\\", "/")}`,
      ],
    };
    const reports = [
      "target/surefire-reports/TEST-example.AppTest.xml",
      "target/surefire-reports/TEST-example.ArchitectureTest.xml",
    ];
    const checks = validateJavaEngineeringChecks({
      javaArchitecture: {
        ...common,
        modules: [
          {
            name: "app",
            reports,
            requiredTestClasses: ["example.ArchitectureTest"],
          },
        ],
      },
      javaCoverage: {
        ...common,
        thresholds: { line: 50, branch: 50, instruction: 50 },
        modules: [
          {
            name: "app",
            reports,
            coverageReport: "target/site/jacoco/jacoco.xml",
          },
        ],
      },
    });
    const architecture = await runJavaEngineeringGate({
      root,
      key: "javaArchitecture",
      config: checks.javaArchitecture,
    });
    assert.equal(architecture.status, "passed", JSON.stringify(architecture));
    const coverage = await runJavaEngineeringGate({
      root,
      key: "javaCoverage",
      config: checks.javaCoverage,
    });
    assert.equal(coverage.status, "passed", JSON.stringify(coverage));
    const insufficient = await runJavaEngineeringGate({
      root,
      key: "javaCoverage",
      config: {
        ...checks.javaCoverage,
        thresholds: { line: 100, branch: 100, instruction: 100 },
      },
    });
    assert.equal(
      insufficient.status,
      "violation",
      JSON.stringify(insufficient),
    );
    assert.ok(
      insufficient.findings.some(
        (item) => item.ruleId === "java/coverage-threshold",
      ),
    );
    fs.writeFileSync(
      path.join(root, "src/main/java/example/service/App.java"),
      "package example.service; public class App { public int value(boolean positive) { return 7; } }",
    );
    const straightLine = await runJavaEngineeringGate({
      root,
      key: "javaCoverage",
      config: {
        ...checks.javaCoverage,
        thresholds: { line: 100, branch: 100, instruction: 100 },
      },
    });
    assert.equal(straightLine.status, "passed", JSON.stringify(straightLine));
    fs.writeFileSync(
      path.join(root, "src/main/java/example/service/IllegalDependency.java"),
      "package example.service; public class IllegalDependency { public final example.controller.Web web = new example.controller.Web(); }",
    );
    const violation = await runJavaEngineeringGate({
      root,
      key: "javaArchitecture",
      config: checks.javaArchitecture,
    });
    assert.equal(violation.status, "violation", JSON.stringify(violation));
    assert.ok(
      violation.findings.some(
        (item) => item.ruleId === "java/architecture-rule-failed",
      ),
    );
    fs.unlinkSync(
      path.join(root, "src/main/java/example/service/IllegalDependency.java"),
    );
    fs.writeFileSync(
      path.join(root, "pom.xml"),
      extendedPom({ jacoco: false }),
    );
    const missing = await runJavaEngineeringGate({
      root,
      key: "javaCoverage",
      config: checks.javaCoverage,
    });
    assert.equal(missing.status, "execution-error", JSON.stringify(missing));
    assert.match(missing.summary, /文件不存在/);
  },
);
