# 按项目配置执行 CI

CI 是可在本地或 Runner 执行的工程检查命令，不需要 GitHub、GitLab 账号或服务器。当前配置不再提供 `ci.profile` 或 `--profile`；不读取、转换旧档位配置。部署通过独立的 `repo-guard.ops.json` 自行接入。

## 执行规则

读取配置 → 确认 Git 范围及受检版本 → 公共必查 → 项目已启用检查 → 汇总结果 → 独立 CI 通知。

每个检查沿用所属项目的工具、脚本、目录、阈值与 enabled。`ci.gatePolicy.gates` 只允许 `inherit` 和 `off`，没有全局关闭模式，也不允许执行失败仅报告或强行开启项目已关闭的可选功能。通知、目录绑定等配置不是独立检查步骤。CI 只读检查格式，不运行源码 fix，测试与构建可生成产物。

公共必查机制包括配置合法性、Git 范围与版本一致性、提交信息、保护文件规则和结果完整性。托管 AGENTS、结构化例外、已启用的合同边界不能单独关闭或缩小检查范围。提交信息在 CI 强制启用，规则内容仍由仓库配置；保护文件的 block 级规则始终阻断。合同引用的可选检查被关闭或跳过时，不能获得完成证据。

可选能力包括 ESLint、Prettier、Stylelint、类型、命名与文档、文件和代码位置、行数、源码安全、依赖、架构、Vue 异步资源、UI Token、图片、无效代码、单元测试及覆盖率、变异测试、构建预算、包体积、Lighthouse 和 Java 源码/工程检查。仅运行适用于项目身份的能力。外部门禁的环境标识仍为 `ci-full`、`release-ready` 或 `manual`，它们是机器执行上下文，不是公开档位；本地可执行已配置外部门禁；在 GitLab 中仍要求保护分支环境。

## 本地使用

先完成项目依赖与原生工具接入，开启 CI 并保存配置、同步托管规范，将需要检查的代码提交到本地 Git。无需远程仓库。

```bash
npx repo-guard enable ci
npx repo-guard doctor --ci
npx repo-guard ci
npx repo-guard ci --base <基准提交> --head <目标提交>
npx repo-guard ci --project api --base <基准提交> --head <目标提交>
```

纯本地不运行 `install-ci`。本地默认以 HEAD 的父提交为 base，以 HEAD 为 head；首次提交缺少父提交时须明确选择有意义的范围，不能将无法解析的范围当作通过。指定 head 不会自动切换或覆盖工作区。

CI 要求当前 HEAD、索引、已跟踪内容及配置与目标提交一致。未提交的修复、暂存区差异、未忽略的额外文件、隐藏索引变更标记、子模块都会阻断，保留用户工作。运行前、步骤之间与运行后重新复核；检查脚本不得修改受检源码或切换版本。忽略 reports、node_modules 及实际构建产物，不能通过忽略源码替代提交。忽略的依赖及外部服务仍由接入者控制，不属于 Git 内容证明。

多应用普通 CI 根据本轮变更选择应用，共享路径及清单变更按配置扩展选择范围；明确 `--project` 时只执行对应应用与公共规则，但仓库版本一致性仍整体核验。各应用保留独立报告，失败不会被另一应用成功覆盖。

## 配置

以下为合并到已有 `repo-guard.config.json` 的片段：

```json
{
  "ci": {
    "enabled": true,
    "reportPath": "reports/repo-guard.json",
    "branches": ["dev", "main"],
    "protectedFiles": { "action": "report" },
    "gatePolicy": {
      "gates": {
        "quality.lighthouse": { "mode": "off" },
        "security.source-security": { "mode": "inherit", "scope": "changed-files" }
      }
    },
    "notification": { "enabled": false }
  }
}
```

| 字段 | 默认与行为 |
|---|---|
| `ci.enabled` | 默认 false；开启后执行 CI，关闭时调用 CI 报配置错误 |
| `ci.reportPath` | 默认 reports/repo-guard.json；必须是仓库 reports 下的 JSON，不能覆盖跟踪文件、使用通知测试保留路径或穿过符号链接 |
| `ci.branches` | 默认 dev、main；GitLab 推送触发的明确分支名，不支持通配符 |
| `ci.protectedFiles.action` | report 或 fail，默认 report；控制普通保护变更，block 规则始终阻断 |
| `ci.gatePolicy.gates.<id>.mode` | 逐项必填 inherit 或 off；缺少该项时跟随项目配置 |
| `ci.gatePolicy.gates.<id>.scope` | 默认 all-files；只有能力登记支持时才允许 changed-files；公共必查不可缩小 |
| `ci.notification.enabled` | 默认 true，可明确关闭；与 reporting.notification 及运维通知独立 |
| `ci.notification.channels` | 默认空数组，最多企业微信和飞书各一个；缺少渠道时提醒配置或关闭 |
| `ci.notification.channels[].provider` | 必填 wecom 或 feishu，不能重复 |
| `ci.notification.channels[].webhook` | 必填官方机器人完整 HTTPS 地址，直接读取仓库配置，不读取环境变量 |
| `ci.notification.channels[].secret` | 可选，仅飞书签名密钥；直接保存于仓库配置 |
| `ci.externalGates` | 所属应用的显式自定义门禁，沿用外部门禁配置及运行信任条件 |

多应用根配置维护 enabled、reportPath、branches、notification；应用维护自己的 gatePolicy、protectedFiles、externalGates。项目 checks 和规则不从其他应用继承。

## 通知与接入测试

CI 成功和失败均发送整体通知，与是否启用部署无关。凭据允许保存在仓库配置中，但日志、报告与消息不展示完整地址或签名密钥。两个渠道独立发送，一个失败不影响另一个，也不改变质量检查退出码。

```json
{
  "ci": {
    "enabled": true,
    "notification": {
      "enabled": true,
      "channels": [
        { "provider": "wecom", "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=替换为实际机器人密钥" },
        { "provider": "feishu", "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/replace-with-real-id", "secret": "替换为实际签名密钥" }
      ]
    }
  }
}
```

只需要一个渠道时删除另一个条目。飞书机器人未启用签名时省略 secret。配置后运行：

```bash
npx repo-guard ci-notification-test
```

命令真实发送测试消息，只有 HTTP 成功且平台业务码为零才确认成功；返回公共退出码，失败返回 1。请在对应群确认收到测试消息。CI 启动时自动检查测试记录，首次、配置变化、记录失效或超过一天时重新发送接入测试消息，再执行质量检查和最终通知。测试记录位于 reports/ci-notification-test.json，只缓存配置指纹和时间，不存储明文凭据；这是本机接入缓存，不是交付证据。更换 Runner 后可能重新测试。

未配置渠道时提醒但继续检查；配置结构错误仍是配置错误。通知超时或响应异常单独报告，不盲目重发可能已经送达的消息。CI 命令尚未启动前的依赖安装失败、强制结束进程或 Runner 掉线无法由此命令保证通知。

## 交付验收与报告

日常 CI 不要求最终人工验收。需要最终复核时单独运行 `npx repo-guard delivery-check`：执行同一套项目检查，默认选择全部应用，最后复核交付证据；不会发布 npm 包或部署应用。关闭或跳过合同必需检查不能完成交付。已有独立合同的联合验证、人工签署和 verify 入口继续有效。

报告格式仍为 version 2，步骤结果为 schemaVersion 2，使用 phase 区分 ci 和 delivery-check，不再输出 profile。总报告默认 reports/repo-guard.json；多应用另保留 reports/repo-guard-workspace/repository.json、应用目录的 reports/repo-guard-workspace/projects/<id>.json 与最终 evidence.json。

退出码：成功或未阻断 0；配置/执行错误 1；违规或交付未满足 2；Git 范围不可信 3。多个失败使用公共优先级，不取首个非零值。关闭项显示跳过，不显示为通过。

[GitLab 接入](gitlab-ci.md) · [公共结果](gate-result-and-reporting.md) · [交付合同](delivery-contract.md) · [执行入口](../../src/orchestration/ci/command.js)
