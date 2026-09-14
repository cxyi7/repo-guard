import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import test from "node:test";
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
