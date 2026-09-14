# 固定消费项目 CI 验收记录

本次范围是 npm 安装产物、配置驱动检查、GitLab 分支与合并请求流水线、失败阻断、分类退出码和飞书通知。两个固定项目当前配置的 CI 专项验收通过。合同、发布部署闭环和其他业务服务不在本次范围内。

共核对 13 条本轮真实流水线，全部作业已结束；[机器可读证据摘要](ci-acceptance-2026-09-14.json)保存每条流水线的提交、来源、作业退出码、报告状态、检查步骤及通知确认。最终两条分支流水线和两条 MR 流水线均成功。原始报告由 GitLab 作业产物保存，默认保留七天。

## 版本与环境

- 包版本：`@cxyi7/repo-guard@2.0.0`，未发布公共 npm。
- 最终安装产物对应包源码提交：`3ca30dde1864a385251c9e372357fbcef3fc5462`，从该提交的干净打包范围生成；后续验收记录和本机目录规范修改不在该产物内。
- 文件：`.vendor/cxyi7-repo-guard-2.0.0.tgz`，两消费项目安装同一产物。
- SHA-256：`4984bcaae98dbcb9f153bc41e0c60653b59fb1323e469de6c005f3ec2b5726d1`。
- 锁文件完整性：`sha512-3ddJIJ5HZHxGfYBhEb8pwbe9h7G0ZfiTx6b1Af7oz5fFP4XV5XC5KOlYpN3TdJPwyPqvMTUOwu9OTS/j5Sh+6w==`。
- 两项目安装后的 538 个包文件逐一与打包源码比对，无差异；锁文件同步，未使用源码链接代替安装产物。
- 本机 Windows：Node `22.23.2`、npm `10.9.8`。
- GitLab Runner：`18.6.2`，Docker 执行器，标签 `docker`。
- 专用镜像：`repo-guard-acceptance-ci:node22-java21`，镜像 ID `sha256:d034316b9a42337d0523fd78ce5bea1270ba11bcb0ba7d6a7622320ef2900913`。
- 镜像工具：Node `22.23.2`、npm `10.9.8`、Temurin JDK `21.0.9`、Maven `3.9.11`；Linux amd64。

## 包内验证

执行 `npm ci --no-audit --no-fund`、`npm run check`、`npm test -- --test-concurrency=4`、`npm run pack:check`。原始基线与模板修复后的完整回归均为 1548 项：1528 通过、20 跳过、0 失败。最终完整回归耗时约 409 秒。静态、架构、语法、中文文案检查通过；打包清单不包含测试临时目录、报告、凭据或仓库本地 `.agents/`。

20 个跳过项为 Windows 的 POSIX 自终止信号场景、需显式开启的 k6 和包管理器联调，以及需原生工具的 Java 扩展／Hook 场景。它们不计为本次通过；其中 npm 冻结安装、Java 编译／JUnit／打包由下述固定消费项目实际覆盖，不据此覆盖其他未测组合。

## 固定项目与通过范围

| 项目 | 最终受检提交 | 主要实际执行内容 |
|---|---|---|
| Vue 前端 `repo-guard-acceptance` | `7c6437096de68eab51a37b1440ed40804924b5f2` | 源码安全、依赖策略、文件归类和行数、ESLint、Prettier、类型检查、4 项 Vitest、Vite 构建 |
| Java 后端 `repo-guard-acceptance-back` | `07964a21a924bdea5ff732b89ae098520c1ad6e7` | Java 工程文件、Maven 编译、3 项 JUnit、JAR 构建 |

两项目均通过当前包的 `install-ci --provider gitlab` 生成模板，重复预览无变更。专用分支 `test/ci-acceptance-2.0.0` 已登记于各自 `ci.branches`。已有 `main`、`test` 触发配置保留；部署规则保持不变，专用分支及 MR 不生成部署作业。

本机前端 `doctor --gitlab` 与正常 `ci` 通过。包内测试并行运行期间曾出现一次前端工具配置加载超时，包内测试结束后复查通过；本机后端 Doctor 正确报告缺少 Maven，后端原生检查在上述真实 Runner 中完成，不能将本机缺项记为通过。

## 真实失败与恢复

| 场景 | 实际结果与证据 |
|---|---|
| 新分支首次推送缺少可信基准 | 前端 [3318](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3318)、后端 [3319](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/pipelines/3319) 拒绝执行；报告为 `range-error`，后续构建跳过。旧 Runner 执行方式将作业码显示为 1，见下方修复 |
| 已有分支正常范围 | 前端 [3321](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3321)、后端 [3320](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/pipelines/3320) 检查与构建均通过；这是模板修复前的本轮证据，不代替最终产物验收 |
| 最终模板正常前端检查与构建 | [3322](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3322) 通过 |
| 前端故意加入 `eval` | [3325](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3325) 检出 `security/no-eval`，作业退出码 2，后续构建跳过；本地同一失败提交也返回 2 |
| 后端故意改变健康接口测试期望值 | [3323](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/pipelines/3323) JUnit 实际执行 3 项、失败 1 项；`java.test` 返回违规码 2，`java.build` 随后因 Maven 打包失败返回执行错误 1，总码按优先级为 1，后续构建跳过 |
| 试图关闭公共提交信息门禁 | 后端 [3324](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/pipelines/3324) 返回 `ci-gate-policy/required-gate`、退出码 1，后续构建跳过；两个消费项目另有已提交配置的本地隔离分支复现 |
| 最终模板下的零基准 | 前端 [3326](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3326) 通过单次推送变量注入零基准，报告 `range-error`，作业退出码 3，后续构建跳过；该单次变量不保留在最终配置 |
| 恢复全部故意失败样例 | 前端 [3328](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3328)、后端 [3327](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/pipelines/3327) 的质量检查和后续构建均通过 |
| 真实合并请求触发 | 前端 [3329](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/pipelines/3329)、后端 [3330](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/pipelines/3330)，来源均为 `merge_request_event`，质量检查和构建通过，不生成部署作业 |

两个消费项目还分别实际验证了未提交源码、已暂存源码、未跟踪文件和未提交配置：均返回 1，修改与暂存内容被保留。无效 Git 版本返回 3。测试后恢复正常分支，工作区干净。公共门禁关闭的验证使用已提交配置，避免将工作区不一致错误误当成策略验证成功。

## 本轮修复

GitLab Runner 18.6.2 的旧 Bash 执行方式会使作业界面将不同非零码显示为 1。包内退出码及 JSON 报告分类原本正确，本轮在质量模板启用 `FF_USE_NEW_BASH_EVAL_STRATEGY` 和 `FF_ENABLE_BASH_EXIT_CODE_CHECK`，补充生成器回归断言并重新打包、安装、生成模板。真实作业已分别保留 1、2、3；不新增公共码表、不修改检查阻断规则。

## 飞书通知

两个消费项目均启用用户提供的飞书机器人及签名密钥，配置只保存在对应私有消费项目。接入测试返回平台业务成功；真实成功、失败 CI 均验证通知。用户已明确确认在测试群看到测试、成功和失败消息。逐项扫描 13 条流水线的日志与质量报告，完整 Webhook 和签名密钥泄漏数为 0；本文不保存 Webhook 或签名密钥。

## 边界与后续

- 本次覆盖两个固定项目当前明确启用的 CI 检查，不代表所有可选检查、Node 后端、Vue JavaScript、多应用、pnpm、Yarn、其他系统或 JDK 组合均完成现场验收。
- Stylelint、Lighthouse、覆盖率、变异测试及未开启的 Java 扩展等仍是跳过，不记为通过。
- 本次没有接入合同验收或发布部署；没有修改两个项目的 Dockerfile、部署脚本或根 CI 构建／部署规则，也没有更新运行容器。最终核对原前端 `87a4d29`、后端 `ba32e1b` 容器仍健康。
- 消费项目 README 中既有配置符号链接、缓存忽略冲突和 JSON 错误回显问题，不因本次正常路径和选定失败场景通过而视为已全部修复；本次使用普通配置文件及显式 `.npm/` 忽略。
- 本次产物未发布 npm；包修复与记录留在 `test/ci-acceptance-2.0.0`。消费项目同名分支已推送，草稿 MR 仅用于质量验收，不自动合并。

草稿合并请求：[前端 !1](http://47.120.4.95:7188/xgjy/repo-guard-acceptance/-/merge_requests/1)、[后端 !1](http://47.120.4.95:7188/xgjy/repo-guard-acceptance-back/-/merge_requests/1)。

[CI 使用](features/ci.md) · [GitLab 接入](features/gitlab-ci.md) · [六项待办](end-to-end-workflow-backlog.md)
