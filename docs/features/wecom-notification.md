# 企业微信通知

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

`init` 会创建被 Git 忽略的 `.env.config`：

```dotenv
REPO_GUARD_WECOM_WEBHOOK=
REPO_GUARD_MENTION_MOBILES=
```

系统环境变量优先于文件值。CI 不读取本地通知凭据，也不发送保护文件通知。

可用 `npx repo-guard enable notification` 或 `disable notification` 切换本地通知开关。凭据填写在本地 `.env.config` 或系统环境中，不能提交到 Git；缺失配置时按 Doctor 提示处理。GitLab 流水线通知有独立设置，见[托管应用交付流水线](managed-delivery-pipeline.md)。

## 触发与预览

本地保护文件流程按匹配级别与通知配置发送消息，并使用变更指纹减少重复通知。先使用只读预览确认范围：

```bash
npx repo-guard dry-run
```

`gate --force-notify` 会显式要求重新通知，使用前应确认变更与接收对象。通知失败按报告排查变量、网络和机器人配置，再使用相同流程重试。

受保护构建的变异测试失败通知还要求对应 `notifyOnFailure` 开启。GitLab 受管流水线开启统一通知时会避免重复发送；该流水线通知使用独立配置与 CI 变量。

## 配置与凭据维护

通知功能默认开启，但不会自动获得 webhook。Doctor 用于检查就绪条件；缺少凭据不代表已发送。不要将 webhook 或手机号复制到共享日志、截图和仓库文档。需要替换机器人时更新本地或受保护 CI 变量，并分别验证对应场景。

通知说明谁修改了哪些受保护内容，审批和是否允许发布仍由团队流程决定。

## 维护依据

[实现入口](../../src/integrations/wecom/notification.js) · [对应测试](../../test/gates/release/notification-gate.test.js)
