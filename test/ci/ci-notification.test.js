import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { notifyCiOutcome } from "../../src/orchestration/ci/notification.js";
import { EXIT_CODES } from "../../src/core/result/exit-code.js";
import { validateCiNotification } from "../../src/config/ci-notification.js";
import {
  postRobotMessage,
  robotPayload,
} from "../../src/integrations/notifications/robots.js";
import { sendCiNotifications } from "../../src/gates/release/ci-notification.js";
import { executionError } from "../../src/core/error/repo-guard-error.js";

const wecom = {
  provider: "wecom",
  webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-only",
};
const feishu = {
  provider: "feishu",
  webhook: "https://open.feishu.cn/open-apis/bot/v2/hook/test-only",
  secret: "test-secret",
};

test("真实 detached HEAD 通知优先平台分支，正确区分合并请求、标签和本地检出", async (t) => {
  mkdirSync("test/.tmp", { recursive: true });
  const root = mkdtempSync(path.resolve("test/.tmp/notification-ref-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q", "-b", "local-topic");
  git("-c", "core.hooksPath=", "-c", "user.name=测试", "-c", "user.email=test@example.invalid",
    "commit", "--allow-empty", "-qm", "test: 通知检出状态");
  const head = git("rev-parse", "HEAD");
  const notification = { name: "api", config: { enabled: true, channels: [feishu] } };
  const message = async (env, exitCode = EXIT_CODES.success) => {
    let content;
    await notifyCiOutcome(root, notification, exitCode, { head }, {
      env, send: async (_, value) => { content = value; },
    });
    assert.ok(content.includes(`目标提交：${head}`));
    assert.doesNotMatch(content, /未命名分支/);
    return content;
  };
  assert.match(await message({ CI_COMMIT_BRANCH: "过期变量" }), /分支：local-topic/);
  git("checkout", "--detach", "-q", head);
  assert.equal(git("branch", "--show-current"), "");
  for (const exitCode of [EXIT_CODES.success, EXIT_CODES.error]) {
    assert.match(await message({ GITLAB_CI: "true", CI_COMMIT_BRANCH: " main " }, exitCode), /分支：main/);
  }
  assert.match(await message({ GITLAB_CI: "true", CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "feat/source",
    CI_COMMIT_BRANCH: "main", CI_COMMIT_REF_NAME: "refs/merge-requests/1/merge" }), /分支：feat\/source/);
  assert.match(await message({ GITLAB_CI: "true", CI_COMMIT_TAG: "v2.1.0", CI_COMMIT_REF_NAME: "v2.1.0" }), /标签：v2\.1\.0/);
  assert.match(await message({ GITLAB_CI: "true", CI_COMMIT_BRANCH: " ", CI_COMMIT_REF_NAME: "refs/special" }), /引用：refs\/special/);
  assert.match(await message({}), /检出方式：指定提交检出（未附着分支）/);
  assert.match(await message({ GITLAB_CI: "true" }), /检出方式：指定提交检出（未附着分支）/);
  const sanitized = await message({ GITLAB_CI: "true", CI_COMMIT_BRANCH: `topic\n${feishu.secret}` });
  assert.match(sanitized, /分支：topic \[已隐藏\]/);
  assert.ok(!sanitized.includes(feishu.secret));
});
function transport(status, body) {
  return (_url, _options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () =>
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = status;
        res.destroy = () => {};
        callback(res);
        res.emit("data", Buffer.from(body));
        res.emit("end");
      });
    return req;
  };
}
test("仓库通知配置接受两平台，拒绝未知地址、重复渠道及错误字段且不回显凭据", () => {
  assert.equal(
    validateCiNotification({ channels: [wecom, feishu] }).channels.length,
    2,
  );
  for (const channels of [
    [wecom, wecom],
    [{ ...wecom, webhook: "https://example.invalid/secret-token" }],
    [{ ...wecom, secret: "secret-token" }],
  ]) {
    assert.throws(
      () => validateCiNotification({ channels }),
      (error) => !error.message.includes("secret-token"),
    );
  }
});
test("飞书按秒时间戳和空消息生成官方签名，企业微信使用文本协议", () => {
  const payload = robotPayload(feishu, "测试消息", 1700000000000);
  assert.equal(payload.timestamp, "1700000000");
  assert.equal(
    payload.sign,
    createHmac("sha256", "1700000000\ntest-secret").update("").digest("base64"),
  );
  assert.deepEqual(robotPayload(wecom, "测试消息"), {
    msgtype: "text",
    text: { content: "测试消息" },
  });
});
test("HTTP 成功仍必须核对平台业务码，拒绝重定向、无效响应和超大响应", async () => {
  for (const channel of [wecom, feishu]) {
    const ok = channel.provider === "wecom" ? { errcode: 0 } : { code: 0 };
    await postRobotMessage(channel, "测试消息", {
      request: transport(200, JSON.stringify(ok)),
    });
    for (const [status, body] of [
      [200, "{}"],
      [200, '{"code":123,"errcode":123}'],
      [302, JSON.stringify(ok)],
      [500, JSON.stringify(ok)],
      [200, "invalid"],
      [200, " ".repeat(70000)],
    ]) {
      await assert.rejects(
        postRobotMessage(channel, "测试消息", {
          request: transport(status, body),
        }),
      );
    }
  }
});
test("请求超时有界，不确定送达时不盲目重发", async () => {
  let destroyed = false;
  await assert.rejects(
    postRobotMessage(wecom, "测试消息", {
      timeoutMs: 10,
      request: () => {
        const req = new EventEmitter();
        req.end = () => {};
        req.destroy = () => {
          destroyed = true;
        };
        return req;
      },
    }),
    /超时/,
  );
  assert.equal(destroyed, true);
});
test("通知分别尝试两个渠道，失败不暴露原始错误和凭据；关闭后不发送", async () => {
  const calls = [];
  const send = async (channel) => {
    calls.push(channel.provider);
    if (channel.provider === "wecom") throw executionError("test/notification-failed", wecom.webhook);
  };
  const output = await sendCiNotifications(
    { enabled: true, channels: [wecom, feishu] },
    "CI 检查成功",
    { send },
  );
  assert.deepEqual(calls, ["wecom", "feishu"]);
  assert.equal(output.exitCode, 1);
  assert.equal(JSON.stringify(output).includes(wecom.webhook), false);
  await sendCiNotifications(
    { enabled: false, channels: [wecom] },
    "CI 检查失败",
    { send },
  );
  assert.equal(calls.length, 2);
});
