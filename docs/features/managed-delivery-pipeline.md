# 托管应用交付流水线

生成验证、部署和通知 Job，实际部署由项目脚本实现。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

通过 `install-ci` 受管 include 接入可选的应用交付标准，不引入另一套 CI 安装方式。npm 包负责生成和校验 GitLab Job、分支规则、阶段、Node 环境、npm 缓存、依赖安装、门禁先行以及手动发布语义；消费项目继续拥有实际构建、上传和部署实现。

消费项目只需实现固定的 npm scripts：

| script | 何时需要 | 项目职责 |
|---|---|---|
| `ci:verify` | 始终 | 对非交付分支执行项目自己的构建或验证 |
| `ci:deploy:test` | 始终 | 发布测试环境；可读取 `CI_COMMIT_BRANCH` 区分 `dev`、`test` 或 `future/*` |
| `ci:deploy:production` | 配置了生产分支时 | 执行人工确认后的生产发布 |
| `ci:deploy:quick` | `quickDeploy: true` | 执行任意分支的人工快速发布 |

示例配置：

```json
{
  "ci": {
    "enabled": true,
    "profile": "policy",
    "pipeline": {
      "enabled": true,
      "verifyStage": "build",
      "deployStage": "deploy",
      "verifyImage": "node:22.23.2",
      "deployImage": "node:22.23.2",
      "testBranches": ["dev", "future/*"],
      "productionBranches": ["publish"],
      "runnerTags": ["docker"],
      "legacyPeerDeps": true,
      "quickDeploy": true,
      "notifications": true
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `ci` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用CI 门禁流程 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `profile` | policy 检查仓库策略；full 加入完整质量检查；release-ready 复核发布准备 | `"policy"` / `"full"` / `"release-ready"`<br>默认：`"policy"` | 只接受列出的值 |
| `pipeline.enabled` | 是否启用受管应用交付流水线 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `pipeline.verifyStage` | 验证 Job 所属的 GitLab stage 名称 | 字符串<br>默认：`"build"` | 仅字母、数字、下划线、点、冒号、连字符 |
| `pipeline.deployStage` | 部署 Job 所属的 GitLab stage 名称 | 字符串<br>默认：`"deploy"` | 仅字母、数字、下划线、点、冒号、连字符 |
| `pipeline.verifyImage` | 执行检查和构建的容器镜像 | 字符串<br>默认：`"node:22.23.2"` | 至多 255 个字符；以字母或数字开头结尾，可含镜像路径、标签或摘要使用的 . _ / : @ - 字符 |
| `pipeline.deployImage` | 执行项目部署脚本的容器镜像，需具备 Node 与脚本所需工具 | 字符串<br>默认：`"node:22.23.2"` | 至多 255 个字符；以字母或数字开头结尾，可含镜像路径、标签或摘要使用的 . _ / : @ - 字符 |
| `pipeline.testBranches` | 允许测试环境交付的分支或受限通配模式 | 字符串数组<br>默认：`["dev"]` | 至少 1 项；元素不可重复；每项：只用字母、数字、点、下划线、斜线、连字符和单个 *；不能含 // 或多个 *；分支列表之间不能冲突；通配符按受限匹配规则使用，不是任意正则。 |
| `pipeline.productionBranches` | 允许生产交付的分支或受限通配模式 | 字符串数组<br>默认：`["publish"]` | 允许空数组；元素不可重复；每项：只用字母、数字、点、下划线、斜线、连字符和单个 *；不能含 // 或多个 *；生产发布保留人工触发。 |
| `pipeline.runnerTags` | 选择 GitLab Runner 的标签集合 | 字符串数组<br>默认：`["docker"]` | 允许空数组；元素不可重复；每项：仅字母、数字、下划线、点、冒号、连字符 |
| `pipeline.legacyPeerDeps` | 是否使用 npm ci --legacy-peer-deps 兼容旧依赖关系 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `pipeline.quickDeploy` | 是否生成可手动触发且不阻断流水线的快速部署 Job | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `pipeline.notifications` | 启用内置企业微信流水线结果通知。成功与失败由 .post 阶段互斥 Job 发送，运行中的受管 Job 被取消时由 after_script 发送已取消通知。需要将 REPO_GUARD_WECOM_WEBHOOK 和可选的 REPO_GUARD_MENTION_MOBILES 配置为受保护的 GitLab CI 变量 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

配置并补齐 scripts 后运行：

```bash
npx repo-guard install-ci --provider gitlab --profile policy --dry-run
npx repo-guard install-ci --provider gitlab --profile policy
npx repo-guard doctor --ci
```

当 `notifications: true` 时，生成器会在 GitLab 保留的 `.post` 末尾阶段增加两个互斥的通知 Job：`repo_guard_notify_success` 使用 `when: on_success`，`repo_guard_notify_failure` 使用 `when: on_failure`。GitLab 根据此前所有阶段的最终结果只执行其中一个，因此整条流水线只发送一条成功或失败通知；任何会阻断流水线的 Job 失败都会进入失败通知。受管 Job 在运行中被手动取消，或前置门禁/验证 Job 被 GitLab 自动取消时，`after_script` 会发送“已取消（canceled）”通知。业务项目不再需要提供 `ci:notify` script。

通知内容包含项目、流水线编号、分支、提交、提交人和流水线链接。提交标题最多显示前 10 个字符，更长时追加省略号。两个末尾通知 Job 都设置 `allow_failure: true`，因此企业微信暂时不可用不会篡改原流水线结果；GitLab 原本标记为 `allow_failure: true` 的非阻断 Job 也继续按成功处理。

在 GitLab 的 CI/CD Variables 中配置：

| 变量 | 要求 | 用途 |
|---|---|---|
| `REPO_GUARD_WECOM_WEBHOOK` | 必需，建议设为 Masked 与 Protected | 企业微信群机器人 Webhook；只接受官方 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...` 地址 |
| `REPO_GUARD_MENTION_MOBILES` | 可选，建议设为 Masked 与 Protected | 逗号分隔的 11 位手机号；未配置时只发消息、不 @ 成员 |

通知命令只允许在 `GITLAB_CI=true` 且带有受管通知标记的生成 Job 中执行。成功、失败和取消入口分别向包内命令传入受控的 `success`、`failed` 或 `canceled` 状态，不会重新加载可能已经导致流水线失败的项目配置。通知包会在 `$CI_BUILDS_DIR` 下按项目、流水线和 Job 组成的唯一目录中，从 npm 官方 tarball URL 精确安装生成流水线时对应版本的 `@cxyi7/repo-guard`；安装时禁用 lifecycle scripts，执行时使用隔离目录中的绝对 CLI 路径，不会解析消费项目的本地可执行文件。因此配置错误或前序 Job 的项目 `npm ci` 失败不会连带阻止末尾通知。

GitLab 只会在运行中的 Job 被取消时执行 `after_script`。因此，取消通知覆盖手动或自动取消时正在运行的 repo-guard 受管 Job；如果 Job 尚未开始就在 pending 状态被取消，或使用 GitLab 强制取消跳过 `after_script`，则 Runner 没有可执行的通知入口。

启用后，`repo_guard` 固定在 GitLab 的 `.pre` stage 覆盖分支和合并请求流水线，确保受管验证与发布 Job 在门禁通过后才执行；测试发布自动执行，生产与快速发布保持手动，其中快速发布允许失败。验证作业会跳过已由测试或生产发布脚本负责构建的分支，避免重复构建。`verifyImage` 和 `deployImage` 分别控制验证与发布容器，二者都必须包含 Node.js 与 npm；Web 容器发布可以把 `deployImage` 指向项目内部维护的 Node.js + Docker CLI 镜像。`install-ci` 与 `doctor --ci` 会拒绝缺少固定 scripts、阶段未声明、保留 Job 名冲突、模板被改写或模板版本不匹配等状态。

## 执行与复核

执行入口：安装后由 GitLab 按分支规则与人工触发条件执行。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/orchestration/cli/install-ci.js) · [对应测试](../../test/ci.test.js)
