import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateJavaEngineeringChecks } from "../../../../src/config/java-engineering.js";
import { runJavaEngineeringGate } from "../../../../src/gates/java/engineering-gates.js";

const enabled = process.env.REPO_GUARD_JAVA_NATIVE_TESTS === "1";
const pom = `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>native-java-fixture</artifactId><version>1.0.0</version><properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency></dependencies><build><plugins>
<plugin><artifactId>maven-clean-plugin</artifactId><version>3.2.0</version></plugin>
<plugin><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
<plugin><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
<plugin><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin>
<plugin><artifactId>maven-jar-plugin</artifactId><version>3.4.1</version></plugin>
<plugin><artifactId>maven-help-plugin</artifactId><version>3.5.2</version></plugin>
<plugin><artifactId>maven-dependency-plugin</artifactId><version>3.7.0</version></plugin>
<plugin><artifactId>maven-enforcer-plugin</artifactId><version>3.5.0</version><executions><execution><id>dependencies</id><goals><goal>enforce</goal></goals><configuration><rules><dependencyConvergence/></rules></configuration></execution></executions></plugin>
</plugins></build><repositories><repository><id>Central Repository</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories><pluginRepositories><pluginRepository><id>Central Repository</id><url>https://repo.maven.apache.org/maven2</url></pluginRepository></pluginRepositories></project>`;
test(
  "真实 Maven 离线编译、打包、JUnit 及有效依赖报告闭环",
  { skip: !enabled, timeout: 240000 },
  async (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "repo guard java native "),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.mkdirSync(path.join(root, "src/main/java/example"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/test/java/example"), { recursive: true });
    fs.writeFileSync(path.join(root, "pom.xml"), pom);
    fs.writeFileSync(
      path.join(root, "src/main/java/example/App.java"),
      "package example; public class App { public int value() { return 7; } }",
    );
    fs.writeFileSync(
      path.join(root, "src/test/java/example/AppTest.java"),
      "package example; public class AppTest { @org.junit.jupiter.api.Test public void value() { org.junit.jupiter.api.Assertions.assertEquals(7, new App().value()); } }",
    );
    execFileSync("git", ["add", "pom.xml", "src"], { cwd: root });
    const common = {
      enabled: true,
      timeoutMs: 90000,
      ...(process.env.REPO_GUARD_JAVA_MAVEN_REPOSITORY
        ? {
            arguments: [
              `-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_MAVEN_REPOSITORY}`,
            ],
          }
        : {}),
    };
    const checks = validateJavaEngineeringChecks({
      javaCompile: {
        ...common,
        modules: [
          {
            name: "app",
            outputs: [
              "target/classes/example/App.class",
              "target/test-classes/example/AppTest.class",
            ],
          },
        ],
      },
      javaBuild: {
        ...common,
        modules: [
          { name: "app", outputs: ["target/native-java-fixture-1.0.0.jar"] },
        ],
      },
      javaTest: {
        ...common,
        modules: [
          {
            name: "app",
            reports: ["target/surefire-reports/TEST-example.AppTest.xml"],
          },
        ],
      },
      javaDependencies: {
        ...common,
        enforcerExecution: "dependencies",
        modules: [
          {
            name: "app",
            effectivePom: "target/effective.xml",
            dependencyTree: "target/dependencies.json",
          },
        ],
      },
    });
    for (const key of [
      "javaCompile",
      "javaBuild",
      "javaTest",
      "javaDependencies",
    ]) {
      const result = await runJavaEngineeringGate({
        root,
        key,
        config: checks[key],
      });
      assert.equal(
        result.status,
        "passed",
        `${key}: ${JSON.stringify(result)}`,
      );
    }
    fs.writeFileSync(
      path.join(root, "src/test/java/example/AppTest.java"),
      'package example; public class AppTest { @org.junit.jupiter.api.Test public void value() { org.junit.jupiter.api.Assertions.fail("验证原生测试失败"); } }',
    );
    const failed = await runJavaEngineeringGate({
      root,
      key: "javaTest",
      config: checks.javaTest,
    });
    assert.equal(failed.status, "violation", JSON.stringify(failed));
    const bannedPom = pom.replace(
      "<dependencyConvergence/>",
      "<dependencyConvergence/><bannedPlugins><excludes><exclude>org.apache.maven.plugins:maven-jar-plugin</exclude></excludes></bannedPlugins>",
    );
    fs.writeFileSync(path.join(root, "pom.xml"), bannedPom);
    const banned = await runJavaEngineeringGate({
      root,
      key: "javaDependencies",
      config: {
        ...checks.javaDependencies,
        requiredEnforcerRules: ["dependencyConvergence", "bannedPlugins"],
      },
    });
    assert.equal(banned.status, "violation", JSON.stringify(banned));
    assert.ok(
      banned.findings.some(
        (item) => item.ruleId === "java/dependency-enforcer",
      ),
    );
    for (const alteredPom of [
      bannedPom.replace(
        "<configuration><rules>",
        "<configuration><rulesToSkip><ruleToSkip>bannedPlugins</ruleToSkip></rulesToSkip><rules>",
      ),
      bannedPom.replace(
        "<bannedPlugins>",
        "<bannedPlugins><level>WARN</level>",
      ),
    ]) {
      fs.writeFileSync(path.join(root, "pom.xml"), alteredPom);
      const weakened = await runJavaEngineeringGate({
        root,
        key: "javaDependencies",
        config: {
          ...checks.javaDependencies,
          requiredEnforcerRules: ["dependencyConvergence", "bannedPlugins"],
        },
      });
      assert.equal(
        weakened.status,
        "configuration-error",
        JSON.stringify(weakened),
      );
    }
    fs.writeFileSync(path.join(root, "pom.xml"), pom);
    fs.writeFileSync(
      path.join(root, "src/main/java/example/App.java"),
      "package example; public class App { invalid java source }",
    );
    const compilation = await runJavaEngineeringGate({
      root,
      key: "javaCompile",
      config: checks.javaCompile,
    });
    assert.equal(compilation.status, "violation", JSON.stringify(compilation));
    assert.ok(
      compilation.findings.some(
        (item) => item.ruleId === "java/compilation-failed",
      ),
    );
    const testsNotRun = await runJavaEngineeringGate({
      root,
      key: "javaTest",
      config: checks.javaTest,
    });
    assert.equal(
      testsNotRun.status,
      "execution-error",
      JSON.stringify(testsNotRun),
    );
  },
);
