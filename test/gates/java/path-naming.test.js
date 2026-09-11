import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { javaPathNamingGate } from "../../../src/gates/java/path-naming-gate.js";
import { validateJavaPathNamingChecks } from "../../../src/config/java-path-naming.js";
import { gateResultToExitCode } from "../../../src/core/result/exit-code.js";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "repo-guard-java-path-naming-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.mkdirSync(path.join(root, "src/main/java/app"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src/main/java/app/bad_name.java"),
    "class App {}",
  );
  execFileSync("git", ["add", "src"], { cwd: root });
  return root;
}
const configured = (enabled = true) => ({
  checks: validateJavaPathNamingChecks({ javaPathNaming: { enabled } }),
});

test("Java 路径命名注册为各阶段只读门禁，配置就绪不依赖 JDK", () => {
  assert.equal(javaPathNamingGate.id, "java.path-naming");
  assert.equal(javaPathNamingGate.manualCommand, "java-path-naming");
  assert.equal(javaPathNamingGate.featureOrder, 570);
  assert.equal(javaPathNamingGate.mutation, "read-only");
  assert.deepEqual(javaPathNamingGate.ciScopes, ["all-files"]);
  assert.deepEqual(javaPathNamingGate.environments, [
    "manual",
    "pre-commit",
    "pre-push",
    "ci-policy",
    "ci-full",
    "release-ready",
  ]);
  assert.equal(
    javaPathNamingGate.inspectSetup({ config: configured() }).status,
    "ready",
  );
});

test("全部阶段读取完整 Git index，不受空变更列表或未暂存工作区重命名影响", async (t) => {
  const root = fixture(t);
  fs.renameSync(
    path.join(root, "src/main/java/app/bad_name.java"),
    path.join(root, "src/main/java/app/GoodName.java"),
  );
  const beforeIndex = execFileSync("git", ["ls-files", "--stage"], {
    cwd: root,
    encoding: "utf8",
  });
  for (const environment of javaPathNamingGate.environments) {
    const result = await javaPathNamingGate.run({
      root,
      config: configured(),
      files: [],
      environment,
      plan: { enabled: true },
    });
    assert.equal(result.status, "violation", environment);
    assert.equal(gateResultToExitCode(result), 2);
    assert.equal(
      result.findings[0].location.path,
      "src/main/java/app/bad_name.java",
    );
  }
  assert.equal(
    execFileSync("git", ["ls-files", "--stage"], {
      cwd: root,
      encoding: "utf8",
    }),
    beforeIndex,
  );
  assert.ok(fs.existsSync(path.join(root, "src/main/java/app/GoodName.java")));
  execFileSync("git", ["add", "-A"], { cwd: root });
  const renamed = await javaPathNamingGate.run({ root, config: configured() });
  assert.equal(renamed.status, "passed");
});

test("显式暂存删除不遗留问题，未跟踪文件不作为 index 命名证据", async (t) => {
  const root = fixture(t);
  execFileSync("git", ["rm", "--cached", "src/main/java/app/bad_name.java"], {
    cwd: root,
  });
  const result = await javaPathNamingGate.run({ root, config: configured() });
  assert.equal(result.status, "passed");
  assert.equal(result.metrics.indexedFiles, 0);
  assert.ok(fs.existsSync(path.join(root, "src/main/java/app/bad_name.java")));
});

test("CI 强制计划启用默认规则，关闭与非法配置各自保持统一结果", async (t) => {
  const root = fixture(t);
  const skipped = await javaPathNamingGate.run({
    root,
    config: configured(false),
  });
  assert.equal(skipped.status, "skipped");
  const forced = await javaPathNamingGate.run({
    root,
    config: configured(false),
    plan: { enabled: true },
  });
  assert.equal(forced.status, "violation");
  const config = configured(false);
  config.checks.javaPathNaming.rules = [];
  const invalid = await javaPathNamingGate.run({
    root,
    config,
    plan: { enabled: true },
  });
  assert.equal(invalid.status, "configuration-error");
  assert.equal(gateResultToExitCode(invalid), 1);
  for (const value of [
    null,
    { enabled: null },
    { enabled: true, include: null },
  ]) {
    const malformed = await javaPathNamingGate.run({
      root,
      config: { checks: { javaPathNaming: value } },
      plan: { enabled: true },
    });
    assert.equal(malformed.status, "configuration-error");
  }
});

test("Git index 无法读取时返回执行错误，不能以空路径通过", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "repo-guard-java-invalid-git-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".git"), "gitdir: missing-repository");
  const result = await javaPathNamingGate.run({ root, config: configured() });
  assert.equal(result.status, "execution-error");
  assert.equal(gateResultToExitCode(result), 1);
});
