# 独立运维与按应用发布

repo-guard 将工程质量与部署配置分开维护。人或 AI 在质量配置中声明前端、Node 后端及项目标识；运维人员在仓库根目录的 `repo-guard.ops.json` 中按同一项目标识选择需要发布的应用。

没有运维配置时默认关闭，不会因为启用 ESLint、测试或构建而生成部署。当前支持 GitLab 和 `stack: "node"` 的应用；Java 运维适配尚未实现，配置 Java 项目不会被当作可发布的 Node 应用。

## 使用流程

质量配置必须先设置 `ci.enabled: true`，可用 `npx repo-guard enable ci` 开启。运维已启用而质量 CI 关闭时，预览与安装会提前报错；已生成流水线中的质量命令也会在 CI 被关闭时返回失败，阻止后续构建与部署。

```bash
# 查看配置、检查脚本，并预览各应用的验证、构建和部署计划；不执行部署
npx repo-guard ops plan

# 生成 .gitlab/ci/repo-guard-operations.yml；已有根流水线保持不变并给出 include 片段
npx repo-guard ops install
```

执行前，项目必须声明对应的构建和部署脚本。生成的任务使用已安装的 repo-guard 与项目工具，适用于 Linux/POSIX Shell Runner；Runner 镜像或上游准备流程负责提供 Node、依赖和部署工具。生成器不下载依赖，不安装系统运行环境，也不实际执行部署。

已有 `.gitlab-ci.yml` 时，根据提示合并 include 并确认 `.pre`、`build`、`deploy` 阶段可用；没有根流水线时生成独立引用。复杂的 include、部署密钥、平台保护和部署脚本仍由项目维护。代码所有权与环境发布权限需要在 GitLab 配置，项目标识不代表授权人。

## 配置示例

以下为带注释的阅读示例。实际 `repo-guard.ops.json` 使用标准 JSON，需要去掉注释。

```jsonc
{
  "$schema": "./node_modules/@cxyi7/repo-guard/operations.schema.json", // 可选：编辑器提示所用的 schema 路径。
  "version": 2,              // 必须为 2；与独立运维配置结构对应。
  "enabled": true,           // 布尔值；默认 false，显式打开才生成作业。
  "provider": "gitlab",      // 当前仅支持 gitlab。
  "projects": {
    "api": {                 // 必须与质量配置的项目 id 一致；小写字母开头、字母数字或连字符，最多 48 位。
      "enabled": true,       // 布尔值；默认 false，控制此应用是否参与流水线。
      "qualityProfile": "full", // full / release-ready；默认 full，不接受仅检查部分规则的 policy 档位。
      "buildScript": "build", // 应用 package.json 已声明的脚本名；不能填写整条命令。
      "artifactPaths": ["dist/"], // 相对应用目录的文件或目录；启用应用时至少一个，构建后必须存在且包含文件。
      "environments": {
        "test": {            // 环境 id 命名规则与项目 id 相同；最终环境名为 api/test。
          "script": "deploy:test", // 应用 package.json 已声明的部署脚本；应部署流水线提供的产物。
          "production": false, // false 为测试环境，通过上游验证后可自动运行。
          "branches": ["dev"] // 至少一个完整分支名；不接受通配符和表达式。
        },
        "production": {
          "script": "deploy:production",
          "production": true, // 默认 true；生产必须手动触发，失败会阻断。
          "branches": ["main"]
        }
      }
    }
  }
}
```

`artifactPaths` 不允许绝对路径、上级目录、空格、反斜杠、通配符或符号链接；例如应用位于 `apps/api` 时，`dist/` 对应仓库中的 `apps/api/dist/`。构建脚本退出成功后还会验证声明的产物存在且非空，避免没有产物仍进入部署。

脚本名允许字母、数字、冒号、点、下划线和连字符，且以字母或数字开头。分支名允许字母、数字、点、下划线、斜杠和连字符，且以字母或数字开头。未知配置字段会直接报错，避免拼写错误被忽略。关闭单个应用可只保留 `{"enabled": false}`。

## 应用隔离与执行顺序

```text
web 的完整质量检查 → web 构建及产物验证 → web/test 或手动 web/production
api 的完整质量检查 → api 构建及产物验证 → api/test 或手动 api/production
```

每个应用都有唯一作业名、环境名、部署互斥组和带提交标识的产物名。构建依赖本应用质量作业成功；部署同时依赖本应用质量与构建，并且只下载该构建作业的产物。任务不使用 `allow_failure: true`，也没有绕开质量检查的快捷发布。

质量入口为 `repo-guard ci --project <id> --profile full`，实际仍遵循团队显式配置的检查项和阈值。完整档位不代表启用了全部可选检查，团队应将必要门禁及运维配置列入保护范围。

前端、后端在同仓时，各自维护对应项目的脚本与环境；分仓时，各仓库生成自己的流水线。本功能不会自动触发另一个仓库，也不会自动把前后端绑定为一次联合发布。

## 配置更新与迁移

重复安装会更新受管的流水线片段，不覆盖同路径的自定义文件或既有根流水线。关闭运维配置后若已有生成的部署片段，安装器会提示先移除根流水线引用、再删除片段，避免误以为修改开关就已经停用了 GitLab 上的部署作业。

旧 `ci.pipeline` 中包含混合验证脚本、快捷发布或没有明确产物边界的配置，无法可靠推导为新结构。迁移遇到已启用或非默认定制时应保留原文件并提示人工拆分，不能静默丢弃旧部署行为。质量配置的迁移与运维迁移分别验证。

## 实现与维护

- `src/operations/config/`：独立配置读取、校验和避免覆盖的写入。
- `src/operations/pipeline/plan.js`：以显式项目清单生成发布计划。
- `src/operations/providers/node.js`：验证 Node 脚本及构建产物，不识别业务框架。
- `src/operations/gitlab/`：流水线渲染、安装和旧模板实现。
- `src/operations/notifications/`：旧 GitLab 通知逻辑，旧公开入口保留薄桥；新按应用流水线尚不生成通知作业。
- `test/operations/`：配置、应用隔离、失败阻断、产物与文件保护验证。

新增运维能力时同步此文档、`operations.schema.json` 和对应测试；新增 Java/Maven/Gradle 适配时实现独立 provider，不能让未实现的运行环境通过就绪检查。
