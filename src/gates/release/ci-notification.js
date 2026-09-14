import { postRobotMessage } from "../../integrations/notifications/robots.js";
import { createGateResult } from "../../core/result/gate-result.js";
import { aggregateGateResults } from "../../core/result/exit-code.js";
import { executionError } from "../../core/error/repo-guard-error.js";

/** 每个渠道独立尝试，失败不阻止另一渠道发送；不自动重发不确定是否已送达的请求。 */
export async function sendCiNotifications(
  notification,
  content,
  { send = postRobotMessage } = {},
) {
  if (!notification.enabled)
    return { results: [], ...aggregateGateResults([]) };
  const results = [];
  for (const channel of notification.channels) {
    const name = channel.provider === "wecom" ? "企业微信" : "飞书";
    try {
      await send(channel, content);
      results.push(
        createGateResult({
          gateId: `ci.notification-${channel.provider}`,
          status: "passed",
          summary: `${name}已确认通知发送成功`,
        }),
      );
    } catch {
      const summary = `${name}通知发送失败，请检查连接、机器人配置及签名；不改变本次质量检查结论`;
      results.push(
        createGateResult({
          gateId: `ci.notification-${channel.provider}`,
          status: "execution-error",
          summary,
          error: executionError("ci-notification/send-failed", summary),
        }),
      );
    }
  }
  return { results, ...aggregateGateResults(results) };
}
