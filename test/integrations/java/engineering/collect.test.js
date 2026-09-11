import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateJavaEngineeringChecks } from "../../../../src/config/java-engineering.js";
import { collectJavaEngineeringFacts } from "../../../../src/integrations/java/engineering/collect.js";
import {
  readFreshJavaFile,
  safeJavaPath,
} from "../../../../src/integrations/java/engineering/files.js";
import { executeMaven } from "../../../../src/integrations/java/engineering/process.js";
import { executionError } from "../../../../src/core/error/repo-guard-error.js";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "repo-guard-java-engineering-"),
  );
  fs.writeFileSync(path.join(root, "pom.xml"), "<project/>");
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("采集器执行固定 Maven 生命周期并读取本次真实输出文件", async (t) => {
  const root = fixture(t);
  const config = validateJavaEngineeringChecks({
    javaTest: {
      enabled: true,
      modules: [{ name: "app", reports: ["target/TEST-app.xml"] }],
    },
  }).javaTest;
  const calls = [];
  const facts = await collectJavaEngineeringFacts({
    root,
    key: "javaTest",
    config,
    execute: async (input) => {
      calls.push(input);
      fs.mkdirSync(path.join(root, "target"));
      fs.writeFileSync(
        path.join(root, "target/TEST-app.xml"),
        '<testsuite tests="1"><testcase name="test" classname="AppTest"/></testsuite>',
      );
      return { status: 0, stdout: "", stderr: "", goals: input.goals };
    },
  });
  assert.deepEqual(calls[0].goals, ["clean", "verify"]);
  assert.equal(facts.modules[0].executed, 1);
  await assert.rejects(
    collectJavaEngineeringFacts({
      root,
      key: "javaTest",
      config,
      execute: async (input) => ({
        status: 0,
        stdout: "",
        stderr: "",
        goals: input.goals,
      }),
    }),
    /本次执行/,
  );
});
test("缺少报告、路径越界和符号链接不能提供通过证据", (t) => {
  const root = fixture(t);
  assert.throws(() => safeJavaPath(root, "../outside.xml"), /项目内/);
  assert.throws(
    () => readFreshJavaFile(root, "missing.xml", Date.now(), null),
    /不存在/,
  );
  const directory = path.join(root, "actual");
  fs.mkdirSync(directory);
  const link = path.join(root, "linked");
  fs.symlinkSync(
    directory,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => safeJavaPath(root, "linked/report.xml", { required: false }),
    /符号链接/,
  );
});
test("启动失败、超时与信号终止均保留执行错误语义", async (t) => {
  const root = fixture(t);
  const config = {
    executable: process.execPath,
    pom: "pom.xml",
    arguments: [],
    offline: true,
    timeoutMs: 1000,
  };
  for (const execution of [
    { status: null, error: executionError("fixture/start", "启动失败") },
    { status: 0, signal: "SIGTERM" },
    { status: 0, timedOut: true },
  ]) {
    await assert.rejects(
      executeMaven({
        root,
        config,
        goals: ["compile"],
        runProcess: async () => execution,
      }),
      (error) => error.kind === "execution",
    );
  }
});
