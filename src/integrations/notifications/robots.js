import https from "node:https";
import { createHmac } from "node:crypto";
import { executionError } from "../../core/error/repo-guard-error.js";

export function robotPayload(channel, content, now = Date.now()) {
  if (channel.provider === "wecom")
    return { msgtype: "text", text: { content } };
  const payload = { msg_type: "text", content: { text: content } };
  if (channel.secret) {
    payload.timestamp = String(Math.floor(now / 1000));
    payload.sign = createHmac(
      "sha256",
      `${payload.timestamp}\n${channel.secret}`,
    )
      .update("")
      .digest("base64");
  }
  return payload;
}

/** 整个请求限时、响应限长，不跟随重定向，不输出第三方回显的凭据。 */
export function postRobotMessage(
  channel,
  content,
  { request = https.request, timeoutMs = 10000 } = {},
) {
  const payload = JSON.stringify(robotPayload(channel, content));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const fail = (code, message) =>
      executionError(`ci-notification/${code}`, message);
    let req;
    try {
      req = request(
        channel.webhook,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (response) => {
          let length = 0;
          const chunks = [];
          response.on("error", () =>
            finish(fail("response-failed", "通知响应读取失败")),
          );
          response.on("aborted", () =>
            finish(fail("response-aborted", "通知响应提前中断")),
          );
          response.on("data", (chunk) => {
            length += chunk.length;
            if (length > 65536) {
              finish(fail("response-too-large", "通知平台响应超过允许大小"));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on("end", () => {
            if (response.statusCode < 200 || response.statusCode >= 300)
              return finish(
                fail("http-failed", "通知平台返回非成功 HTTP 状态"),
              );
            let result;
            try {
              result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              return finish(
                fail("invalid-response", "通知平台未返回有效 JSON"),
              );
            }
            const accepted =
              channel.provider === "wecom"
                ? result?.errcode === 0
                : result?.code === 0;
            finish(
              accepted
                ? null
                : fail(
                    "rejected",
                    "通知平台未确认发送成功，请检查机器人地址、签名、关键词与允许的 IP 设置",
                  ),
            );
          });
        },
      );
      req.on("error", () =>
        finish(fail("request-failed", "通知请求失败，请检查网络和机器人配置")),
      );
      timer = setTimeout(() => {
        finish(fail("timeout", "通知发送超时，尚不能确认平台是否已经收到消息"));
        req.destroy();
      }, timeoutMs);
      req.end(payload);
    } catch {
      finish(
        fail("request-failed", "无法启动通知请求，请检查网络和机器人配置"),
      );
    }
  });
}
