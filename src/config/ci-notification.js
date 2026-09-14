import {
  assertKnownProperties,
  configValidationError,
} from "./validation-primitives.js";

export const CI_NOTIFICATION_PROVIDERS = Object.freeze(["wecom", "feishu"]);
export const CI_NOTIFICATION_TEST_REPORT = "reports/ci-notification-test.json";

/** 配置只读取仓库中的值；错误消息不回显地址或签名密钥。 */
export function validateCiNotification(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw configValidationError("ci.notification 必须是对象");
  assertKnownProperties(
    value,
    new Set(["enabled", "channels"]),
    "ci.notification",
  );
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    throw configValidationError("ci.notification.enabled 必须是布尔值");
  const channels = value.channels === undefined ? [] : value.channels;
  if (!Array.isArray(channels) || channels.length > 2)
    throw configValidationError(
      "ci.notification.channels 最多包含企业微信和飞书两个渠道",
    );
  const providers = new Set();
  return {
    enabled: value.enabled ?? true,
    channels: channels.map((channel) => {
      if (!channel || typeof channel !== "object" || Array.isArray(channel))
        throw configValidationError("CI 通知渠道必须是对象");
      assertKnownProperties(
        channel,
        new Set(["provider", "webhook", "secret"]),
        "CI 通知渠道",
      );
      if (
        !CI_NOTIFICATION_PROVIDERS.includes(channel.provider) ||
        providers.has(channel.provider)
      )
        throw configValidationError(
          "CI 通知渠道只能使用不重复的 wecom 或 feishu",
        );
      providers.add(channel.provider);
      let url;
      try {
        url = new URL(channel.webhook);
      } catch {
        throw configValidationError(
          "CI 通知 Webhook 地址无效，请填写对应机器人的完整 HTTPS 地址",
        );
      }
      const validEndpoint =
        channel.provider === "wecom"
          ? url.hostname === "qyapi.weixin.qq.com" &&
            url.pathname === "/cgi-bin/webhook/send" &&
            url.searchParams.getAll("key").length === 1 &&
            Boolean(url.searchParams.get("key")) &&
            [...url.searchParams.keys()].every((key) => key === "key")
          : url.hostname === "open.feishu.cn" &&
            /^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/.test(url.pathname) &&
            !url.search;
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        url.port ||
        !validEndpoint
      )
        throw configValidationError(
          "CI 通知 Webhook 必须使用对应平台的官方机器人地址，不允许重定向地址或额外参数",
        );
      if (
        channel.secret !== undefined &&
        (channel.provider !== "feishu" ||
          typeof channel.secret !== "string" ||
          !channel.secret.trim())
      )
        throw configValidationError("只有飞书渠道可填写非空签名密钥 secret");
      return {
        provider: channel.provider,
        webhook: channel.webhook,
        ...(channel.secret === undefined ? {} : { secret: channel.secret }),
      };
    }),
  };
}
