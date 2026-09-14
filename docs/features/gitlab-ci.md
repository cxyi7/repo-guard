# GitLab CI 接入

[按项目配置执行 CI](ci.md)介绍本地用法、必查与可选规则、配置和独立通知。CI 不再提供档位；部署使用独立的 repo-guard.ops.json，不由质量接入自动开启。

## 准备与安装

准备 GitLab 项目、可用 Runner、项目工具及锁文件。模板使用 Node 镜像；Java 的 JDK/Maven、Lighthouse 的 Chrome 等环境按实际启用的能力补齐。

```bash
npx repo-guard install-ci --provider gitlab --dry-run
npx repo-guard install-ci --provider gitlab
npx repo-guard doctor --gitlab
```

模板 .gitlab/ci/repo-guard.yml 只提供 .repo_guard_ci 作业，执行 repo-guard ci。根 .gitlab-ci.yml 引用模板并选择 stage。未传 stage 时从已有 verify、test、quality 中选择；没有声明时使用 test。

安装只接受带内容指纹的当前 v4 模板与当前根区块；旧版、未知格式和人工修改均拒绝覆盖，原文件保持。已有自定义 include 时按预览人工合并。没有转换旧配置或模板的入口。

## 触发

ci.branches 默认包含 dev、main，可配置为实际需要的完整分支名。分支推送且没有已打开的合并请求时执行；创建或更新合并请求时执行合并请求任务，避免同一推送重复执行两条流水线。

修改 ci.branches 后重新运行 install-ci，未被人工修改的当前模板会更新触发规则；可先用 --dry-run 预览，再一同提交配置和模板。只修改 JSON 不会直接改变远端已经保存的流水线规则。

例如：开发分支的五个提交 cherry-pick 到本地 dev，再推送 dev，触发一轮检查。GitLab 提供推送前后的提交号作为 base/head。第一次推送缺少有效 base 时需显式配置真实基准，不能把零 SHA 当作可信范围。

质量命令在目标提交的干净工作区运行。Git 历史深度设置为 0，依赖安装跳过 Hook。通过 npx --no-install、pnpm exec 或 yarn exec 调用已安装的工具；不在检查时自动下载新版 repo-guard。

## 包管理器与冻结安装

按项目声明的 npm、pnpm 或 Yarn 版本生成准备命令：npm ci、pnpm install --frozen-lockfile、Yarn 1 的 yarn install --frozen-lockfile、现代 Yarn 的 yarn install --immutable。模板只接受原生默认锁文件路径，自定义路径由项目单独维护并验证安装流程。

## 报告、通知和部署

无论质量成功或失败，模板收集根 reports/ 报告并保留七天。多应用独立报告仍位于应用目录，可按团队产物收集规则另外归档。CI 通知从仓库 ci.notification 读取企业微信或飞书配置，成功失败都发送；先完成 ci-notification-test，首次环境会自动测试。

流水线中的依赖安装失败可能早于 repo-guard 启动，此时本命令不能发送通知；Runner 强制中断也不保证通知。平台合并条件与环境权限由 GitLab 设置。检查失败不会撤销已经推送的提交。

只有用户另行启用运维配置时才生成构建与部署；CI 通知与运维通知独立。详见[独立运维](operations.md)、[结果与报告](gate-result-and-reporting.md)。

[实现入口](../../src/operations/gitlab/gitlab-ci.js) · [CI 执行](../../src/orchestration/ci/command.js)
