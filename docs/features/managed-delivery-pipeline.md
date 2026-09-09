# 按应用管理的交付流水线

[返回使用说明](../usage-guide.md) · [功能索引](README.md) · [完整运维配置](operations.md)

v2 将工程质量和运维发布拆开。前端、Node 后端使用同一套质量入口，各应用分别声明构建产物、部署脚本和目标环境；不同负责人可以独立维护、独立发布。

## 当前接入入口

1. 在质量配置中显式声明应用的 `project.id`、`role`、`stack` 和 `preset`；多应用仓库由根清单指定应用目录。
2. 在各应用 `package.json` 中声明真实构建、部署脚本。
3. 在仓库根目录的 `repo-guard.ops.json` 中，以相同项目标识开启对应发布单元。
4. 先预览，再生成流水线；已有根配置时按提示合并 include。

```bash
# 检查独立运维配置与项目脚本，输出发布计划和 YAML，不执行部署
npx repo-guard ops plan

# 生成受管流水线片段；不覆盖既有根流水线
npx repo-guard ops install

# 复核当前质量/运维 CI 接入状态
npx repo-guard doctor --ci
```

质量检查安装命令 `install-ci` 只负责质量模板。部署通过 `ops plan / ops install` 独立接入，不再由 `ci.pipeline` 配置开启。先启用质量配置中的 `ci.enabled`；质量 CI 关闭时，运维预览和安装会提前阻止，已生成作业也不能把关闭检查当作质量通过。

## 一次发布的顺序

```text
web：完整质量检查 → web 构建 → web 产物检查 → web/test 或手动 web/production
api：完整质量检查 → api 构建 → api 产物检查 → api/test 或手动 api/production
```

| 阶段 | repo-guard 负责 | 项目或平台负责 |
|---|---|---|
| 准备 | 验证显式项目、脚本名称与配置结构 | 在 Runner 准备 Node、依赖和部署工具 |
| 质量 | 按应用调用 `repo-guard ci --project <id>` | 配置团队必需的检查项和阈值 |
| 构建 | 依赖本应用质量通过，执行指定构建脚本并检查产物 | 脚本生成可部署文件 |
| 部署 | 只获取本应用成功构建的产物，按允许分支和环境触发 | 脚本上传或部署；平台落实环境权限和凭据 |

构建和部署不得使用 `allow_failure: true`，没有绕过质量检查的快捷部署。生产环境默认且必须手动触发。完整质量档位会执行团队已配置的能力，不代表自动打开全部可选功能。

## 配置与环境要求

完整字段说明和带注释示例见[独立运维配置](operations.md#配置示例)。主要字段如下：

| 字段 | 作用与要求 |
|---|---|
| `version` | 必须为 `2` |
| `enabled` | 总开关，布尔值，默认 `false` |
| `provider` | 当前仅支持 `gitlab` |
| `projects.<id>.enabled` | 应用发布开关，默认 `false`，`id` 必须与质量配置一致 |
| `qualityProfile` | `full` / `release-ready`，默认 `full` |
| `buildScript` | 应用 `package.json` 中存在的脚本名，不能填写命令 |
| `artifactPaths` | 相对应用目录的具体文件/目录，启用时至少一个，构建后必须非空 |
| `environments.<环境>.script` | 此环境的部署脚本名，应用必须已声明 |
| `environments.<环境>.production` | 默认 `true`，生产手动；`false` 为测试环境 |
| `environments.<环境>.branches` | 至少一个明确分支名，不接受通配符或表达式 |

配置独立于项目业务语言的目录命名，但当前 provider 仅实现 `stack: node` 应用。GitLab 生成脚本使用 Linux/POSIX Shell；根流水线需要提供 `.pre`、`build`、`deploy` 阶段，Runner 或上游准备流程提供工具和依赖。生成器不安装 npm 依赖、JDK 或系统工具，不替项目生成部署脚本。

同仓可以使用多个应用发布单元，分仓由各仓库分别管理。不同应用使用独立作业名、环境名和部署互斥组；产物名带应用与提交标识。当前不自动跨仓触发、不隐式联合发布，也不为新流水线生成通知作业。

## 更新、禁用与迁移

- 修改运维配置后先运行 `ops plan`，再运行 `ops install`，复核受管 YAML 差异。
- 重复生成仅更新带受管标记的片段；同路径自定义文件和已有根配置不会被直接覆盖。
- 禁用运维后若片段仍存在，工具会提示先移除根流水线引用，再删除片段；仅修改 JSON 开关不会自动停止 GitLab 已读取的作业。
- `ci.pipeline` 已从 v2 质量配置移除。旧配置的固定 `ci:verify`、快速发布、通知等不能可靠推导为新应用产物模型，迁移器会保留原文件并提示人工拆分，不会静默丢失配置。

## 实现与复核

[CLI 入口](../../src/orchestration/cli/operations.js) · [计划](../../src/operations/pipeline/plan.js) · [生成与安装](../../src/operations/gitlab/installation.js) · [配置 Schema](../../operations.schema.json) · [专项测试](../../test/operations/pipeline.test.js)
