import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  normalizeProjectDocument,
  serializeProjectConfig,
} from "../../src/config/project-configuration.js";
import { syncAgentPolicies } from "../../src/policies/agent-policies.js";
import { runCiCommand } from "../../src/orchestration/ci/command.js";
import { validateCiConfiguration } from "../../src/config/ci-validation.js";
import { createProjectGateRegistry } from "../../src/gates/registry.js";
import {
  validateCiGatePolicy,
  REQUIRED_CI_GATES,
} from "../../src/orchestration/ci/gate-policy.js";
import { runDoctor } from "../../src/orchestration/doctor/runner.js";
import { assertCiSubject } from "../../src/orchestration/ci/subject.js";
import https from "node:https";
import { EventEmitter } from "node:events";

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}
function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "configured-ci-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  git(root, "config", "user.name", "CI 测试");
  git(root, "config", "user.email", "ci@example.invalid");
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, ".gitignore"), "reports/\nnode_modules/\n");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "ci-fixture", version: "1.0.0" }),
  );
  writeFileSync(path.join(root, "src/main.js"), "export const value = 1;\n");
  const config = normalizeProjectDocument({
    version: 2,
    project: {
      id: "api",
      role: "backend",
      stack: "node",
      preset: "node-javascript",
    },
    checks: {
      eslint: { enabled: false },
      prettier: { enabled: false },
      maxFileLines: {
        enabled: true,
        rules: [{ pattern: "src/**", maxLines: 2 }],
      },
    },
    repository: {
      rules: [
        { pattern: "protected/**", category: "保护文件", level: "block" },
      ],
      dependencyPolicy: { enabled: false },
    },
    reporting: { notification: { enabled: false } },
    ci: { enabled: true, notification: { enabled: false } },
  });
  writeFileSync(
    path.join(root, "repo-guard.config.json"),
    JSON.stringify(serializeProjectConfig(config)),
  );
  syncAgentPolicies(root, config);
  git(root, "add", ".");
  git(root, "-c", "core.hooksPath=", "commit", "-qm", "chore: 初始化");
  const base = git(root, "rev-parse", "HEAD");
  writeFileSync(path.join(root, "src/main.js"), "export const value = 2;\n");
  git(root, "add", ".");
  git(root, "-c", "core.hooksPath=", "commit", "-qm", "feat: 修改实现");
  return { root, base, head: git(root, "rev-parse", "HEAD"), config };
}
function report(root) {
  return JSON.parse(
    readFileSync(path.join(root, "reports/repo-guard.json"), "utf8"),
  );
}

test("CI 拒绝旧档位和旧模式，默认通知开启且可单独关闭", () => {
  const ci = validateCiConfiguration({}, "测试配置");
  assert.deepEqual(ci.notification, { enabled: true, channels: [] });
  assert.deepEqual(ci.branches, ["dev", "main"]);
  assert.equal("profile" in ci, false);
  for (const value of [
    { profile: "full" },
    { gatePolicy: { defaultMode: "off" } },
    { gatePolicy: { gates: { "quality.eslint": { mode: "report" } } } },
  ]) {
    assert.throws(() => validateCiConfiguration(value, "测试配置"));
  }
  assert.equal(
    validateCiConfiguration({ notification: { enabled: false } }, "测试配置")
      .notification.enabled,
    false,
  );
});

test("公共必查项不能关闭或缩小范围，可选检查可关闭", () => {
  const config = normalizeProjectDocument({
    version: 2,
    project: {
      id: "api",
      role: "backend",
      stack: "node",
      preset: "node-javascript",
    },
  });
  const registry = createProjectGateRegistry(config);
  for (const id of REQUIRED_CI_GATES) {
    for (const policy of [
      { mode: "off", scope: "all-files" },
      { mode: "inherit", scope: "changed-files" },
    ]) {
      assert.throws(
        () =>
          validateCiGatePolicy(
            {
              ...config,
              ci: { ...config.ci, gatePolicy: { gates: { [id]: policy } } },
            },
            registry,
          ),
        /公共必查/,
      );
    }
  }
  assert.doesNotThrow(() =>
    validateCiGatePolicy(
      {
        ...config,
        ci: {
          ...config.ci,
          gatePolicy: {
            gates: { "quality.eslint": { mode: "off", scope: "all-files" } },
          },
        },
      },
      registry,
    ),
  );
});

test("本地 CI 无需平台，执行已配置规则并始终检查提交信息", async (t) => {
  const repo = repository(t);
  assert.equal(
    await runCiCommand(repo.root, {
      base: repo.base,
      head: repo.head,
      env: {},
    }),
    0,
  );
  const output = report(repo.root);
  assert.equal(output.phase, "ci");
  assert.equal("profile" in output, false);
  assert.equal(
    output.steps.find((x) => x.name === "repository.commit-message").gateResult
      .status,
    "passed",
  );
  assert.equal(
    output.steps.filter((x) => x.gateResult.gateId === "quality.unit-test")
      .length,
    1,
  );
  assert.equal(
    output.steps.find((x) => x.name === "eslint").gateResult.status,
    "skipped",
  );
  git(
    repo.root,
    "-c",
    "core.hooksPath=",
    "commit",
    "--allow-empty",
    "-qm",
    "不符合提交规范",
  );
  assert.equal(
    await runCiCommand(repo.root, { base: repo.base, head: "HEAD", env: {} }),
    2,
  );
});

test("未提交修复、仅暂存修复及不同 HEAD 不得替目标提交通过", async (t) => {
  const repo = repository(t);
  writeFileSync(path.join(repo.root, "src/main.js"), "export const value = 2;\nexport const extra = 3;\nexport const tooManyLines = true;\n");
  git(repo.root, "add", ".");
  git(repo.root, "-c", "core.hooksPath=", "commit", "-qm", "test: 保存超过行数上限的提交");
  repo.head = git(repo.root, "rev-parse", "HEAD");
  for (const staged of [false, true]) {
    writeFileSync(
      path.join(repo.root, "src/main.js"),
      "export const value = 3;\n",
    );
    if (staged) git(repo.root, "add", "src/main.js");
    assert.equal(
      await runCiCommand(repo.root, {
        base: repo.base,
        head: repo.head,
        env: {},
      }),
      1,
    );
    assert.match(report(repo.root).error, /受检内容与目标提交不一致/);
    assert.equal(git(repo.root, "rev-parse", "HEAD"), repo.head);
    assert.equal(readFileSync(path.join(repo.root, "src/main.js"), "utf8"), "export const value = 3;\n");
  }
  assert.throws(() => assertCiSubject(repo.root, repo.base), /受检内容/);
});

test("未跟踪源码及隐藏索引标记不能绕过版本绑定", (t) => {
  const repo = repository(t);
  writeFileSync(
    path.join(repo.root, "src/new.js"),
    "export const extra = true;",
  );
  assert.throws(() => assertCiSubject(repo.root, repo.head));
  git(repo.root, "add", ".");
  git(repo.root, "-c", "core.hooksPath=", "commit", "-qm", "feat: 添加文件");
  const head = git(repo.root, "rev-parse", "HEAD");
  git(repo.root, "update-index", "--assume-unchanged", "src/main.js");
  assert.throws(() => assertCiSubject(repo.root, head), /索引标记/);
});

test("本地 Doctor 的 CI 检查不要求 GitLab 文件", async (t) => {
  const repo = repository(t);
  const result = await runDoctor(repo.root, { ci: true });
  assert.equal(result.exitCode ?? result, 0);
});

test("被忽略的配置不能生成提交的通过报告", async (t) => {
  const repo = repository(t);
  git(repo.root, "rm", "--cached", "repo-guard.config.json");
  writeFileSync(
    path.join(repo.root, ".gitignore"),
    "reports/\nnode_modules/\nrepo-guard.config.json\n",
  );
  git(repo.root, "add", ".");
  git(repo.root, "-c", "core.hooksPath=", "commit", "-qm", "test: 忽略配置");
  assert.equal(
    await runCiCommand(repo.root, { base: repo.base, head: "HEAD", env: {} }),
    1,
  );
  assert.equal(
    report(repo.root).gateResult.error.code,
    "ci/untracked-configuration",
  );
});

test("CI 自动测试接入并发送整轮成功结果，配置错误也通知且发送失败不掩盖质量错误", async (t) => {
  const repo = repository(t);
  const file = path.join(repo.root, "repo-guard.config.json");
  const document = JSON.parse(readFileSync(file, "utf8"));
  document.ci.notification = {
    channels: [
      {
        provider: "wecom",
        webhook:
          "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-only",
      },
    ],
  };
  writeFileSync(file, JSON.stringify(document));
  git(repo.root, "add", ".");
  git(repo.root, "-c", "core.hooksPath=", "commit", "-qm", "test: 配置通知");
  const messages = [];
  let fail = false;
  t.mock.method(https, "request", (_url, _options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = (body) => {
      messages.push(JSON.parse(body).text.content);
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        callback(response);
        response.emit(
          "data",
          Buffer.from(JSON.stringify({ errcode: fail ? 400 : 0 })),
        );
        response.emit("end");
      });
    };
    return req;
  });
  assert.equal(
    await runCiCommand(repo.root, { base: repo.base, head: "HEAD", env: {} }),
    0,
  );
  assert.equal(messages.length, 2);
  assert.match(messages[0], /通知接入测试/);
  assert.match(messages[1], /CI 检查成功/);
  document.checks.eslint.enabled = "invalid";
  writeFileSync(file, JSON.stringify(document));
  fail = true;
  assert.equal(await runCiCommand(repo.root, { env: {} }), 1);
  assert.equal(messages.length, 3);
  assert.match(messages[2], /CI 检查失败/);
  assert.equal(
    messages.some((message) => message.includes("key=test-only")),
    false,
  );
});
