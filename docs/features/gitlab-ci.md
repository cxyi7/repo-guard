# GitLab CI 与逐 Gate 策略

用固定配置档复核可信 Git 范围，并保存结构化报告。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例使用配置 v2。项目身份由人或 AI 显式提供；基础预设决定默认值，不根据已安装工具自动开启能力。主配置片段合并到已有文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到仓库根目录的 `repo-guard.config.json`。`ci` 统一定义质量检查策略；多应用的子配置只维护项目身份与 `checks`，不能覆盖根目录的 CI 策略。直接编辑 v2 配置后运行 `npx repo-guard doctor`。

安装或检查 CI：

```bash
npx repo-guard install-ci --provider gitlab --profile policy --dry-run
npx repo-guard install-ci --provider gitlab --profile policy
npx repo-guard doctor --ci
```

`install-ci` 未传 `--profile` 时沿用当前 `ci.profile`，不会将已有 `full` 或 `release-ready` 降为 `policy`；只有显式传入该选项才覆盖配置档，预览和实际安装遵循相同规则。

安装先只读校验已有 Skill 清单和各相关目录的 `AGENTS.md` 标记。旧格式会在写入 CI 模板、主配置或规范前拒绝，原文件保持不变；缺失文件和当前格式下待同步的正文不会因此被拒绝。

显式执行：

```bash
npx repo-guard ci --profile policy --base <sha> --head <sha>
npx repo-guard ci --profile full --base <sha> --head <sha>
npx repo-guard ci --profile release-ready --base <sha> --head <sha>
npx repo-guard ci --profile full --project api --base <sha> --head <sha>
```

| 配置档 | 内容 |
|---|---|
| `policy` | 结构化例外、AGENTS、提交信息、异步资源、路径命名、UI Token、安全与基础可访问性、依赖、文件归位、图片、代码位置、行数、交付合同、单元测试资料策略、保护文件 |
| `full` | `policy` 加只读 Stylelint、ESLint、Prettier、类型检查、Knip、无效图片、完整单元测试/覆盖率、axe、架构和构建 |
| `release-ready` | 使用 `full` 的通用工程检查，加适用且启用的 Lighthouse 和最终交付证据复核；不强制项目提供固定的 `check`、`test`、`pack:check` 脚本，不执行 npm 发布 |

CI 不执行源码 fix、不安装 Hook、不读取本地企业微信凭据；测试、构建和报告仍会生成产物。流水线生成与部署由独立的[运维模块](managed-delivery-pipeline.md)管理，开启 CI 质量检查不会连带开启部署。

`install-ci` 生成的模板只包含质量基类与 `policy / full / release-ready`，不生成构建发布基类、部署作业或通知。已有模板必须使用当前标记，且正文与当前生成模板一致，才允许重复安装；旧模板、未知内容或人工修改会被拒绝并保留原文件，不提供自动转换。根托管区块也必须符合当前结构；自定义 include 或无法识别的区块需人工合并预览。构建和部署按独立的 `repo-guard.ops.json` 重新接入。

## 多应用执行与负责人

仓库通过 `projects` 清单明确配置前端、Node 后端及它们的目录。默认执行清单中的全部应用；`--project api` 只验证 `api` 应用并复核公共仓库规则，报告不会把未选择的前端显示为通过。

仓库规则执行一次，应用检查依次在各自目录运行。依赖策略检查每个应用的 `package.json`；仓库根目录另外存在 `package.json` 时也会检查。Git 变更路径转换为应用相对路径，包括跨应用重命名，避免检查错误的文件。

`repository.agent-policy` 同时核验仓库公共 `AGENTS.md` 和所选应用各自的 `AGENTS.md`，使用对应目录的配置生成期望内容。默认策略下，任一受管规范缺失、过期或被改写都会阻断。使用 `--project web` 时检查公共规范与 web 规范，不检查未选择的 api 规范；报告也不会宣称 api 已通过。

如果清单中唯一应用声明 `root: "."` 并使用独立的应用配置文件，仓库与应用共用同一个 `AGENTS.md`。该文件只在应用范围按应用配置检查一次，避免同一路径被要求满足两种文本。

| 报告 | 路径与内容 |
|---|---|
| 聚合报告 | 根目录 `ci.reportPath`，默认 `reports/repo-guard.json`；列出选择的应用、各目标退出码、独立报告和聚合门禁结果 |
| 公共仓库报告 | `reports/repo-guard-workspace/repository.json` |
| 应用报告 | 各应用目录内的 `reports/repo-guard-workspace/projects/<项目 id>.json` |
| 最终交付证据报告 | `release-ready` 执行完成后的 `reports/repo-guard-workspace/evidence.json` |

单应用、聚合报告、各目标报告及配置或范围错误报告统一使用 `version: 2`。写入和汇总只接受版本 2，嵌套目标中的版本 1 也会被拒绝；旧报告需重新运行 CI 生成，不会自动转换。各步骤的 `GateResult` 使用 `schemaVersion: 2`。

聚合报告与各目标报告不得使用同一路径；报告不覆盖受跟踪文件或穿过符号链接。应用检查互相隔离，任何按策略必须阻断的失败都会使整体退出码非零。前后端负责人可在各自 CI 作业中选择应用；联合验证时不传 `--project`。

## CI 门禁策略

`ci.gatePolicy` 只控制 `npx repo-guard ci` 使用的 `ci-policy`、`ci-full` 和 `release-ready` 环境，不会被 pre-commit 或 pre-push 读取。同一个 Gate 可以在提交时强制执行、在 CI 中关闭，也可以在提交时关闭、仅在 CI 中报告或强制执行。

```json
{
  "ci": {
    "enabled": true,
    "profile": "policy",
    "reportPath": "reports/repo-guard.json",
    "protectedFiles": {
      "action": "report"
    },
    "gatePolicy": {
      "defaultMode": "inherit",
      "gates": {
        "security.dynamic-code": {
          "mode": "enforce",
          "scope": "changed-files"
        },
        "accessibility.vue-image-alt": {
          "mode": "report"
        },
        "repository.maximum-file-lines": {
          "mode": "off"
        }
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `ci.enabled` | 是否启用CI 门禁流程 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `ci.profile` | policy 检查仓库策略；full 加入完整质量检查；release-ready 复核发布准备 | `"policy"` / `"full"` / `"release-ready"`<br>默认：`"policy"` | 只接受列出的值 |
| `ci.reportPath` | 整体 CI JSON 报告的仓库相对路径 | 字符串<br>默认：`"reports/repo-guard.json"` | 仓库相对 reports/*.json 路径；必须在 reports/ 下以 .json 结尾，不覆盖已跟踪文件，不经过符号链接。 |
| `ci.protectedFiles.action` | report 报告受保护变更；fail 阻断此类变更；block 级规则始终阻断 | `"report"` / `"fail"`<br>默认：`"report"` | 只接受列出的值 |
| `ci.gatePolicy.defaultMode` | inherit 继承功能配置；off 跳过；report 执行但不阻断；enforce 执行并按失败阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>默认：`"inherit"` | 只接受列出的值 |
| `ci.gatePolicy.gates.security.dynamic-code.mode` | 覆盖该 Gate 的 CI 模式：继承、跳过、只报告或强制阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `ci.gatePolicy.gates.security.dynamic-code.scope` | 该 Gate 的检查范围；changed-files 只可用于 Registry 声明支持的能力 | `"all-files"` / `"changed-files"`<br>默认：`"all-files"` | 只接受列出的值 |
| `ci.gatePolicy.gates.accessibility.vue-image-alt.mode` | 覆盖该 Gate 的 CI 模式：继承、跳过、只报告或强制阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `ci.gatePolicy.gates.repository.maximum-file-lines.mode` | 覆盖该 Gate 的 CI 模式：继承、跳过、只报告或强制阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |

<!-- config-fields:end -->

| 模式 | CI 行为 |
|---|---|
| `inherit` | 沿用 Gate 原有 `enabled` 配置，失败会阻断 CI |
| `off` | 在 setup 和执行之前跳过该 CI Gate，不阻断 CI |
| `report` | 仅在隔离的 CI 上下文中启用并执行，失败写入步骤报告但不阻断 CI |
| `enforce` | 仅在隔离的 CI 上下文中启用并执行，失败阻断 CI |

`scope` 默认为 `all-files`。只有 Registry 明确声明支持文件范围的 Gate 才能使用 `changed-files`；不支持的组合会作为配置错误失败，而不是静默缩小检查范围。

`release-ready` 包含完整工程检查，并在所有应用检查之后复核交付证据。具体构建和测试脚本分别由 `checks.build.script`、`checks.unitTest.script` 等配置；未启用或不适用的能力显示跳过。后端项目不会执行 Vue 专用检查，CI 模式不会把前端能力强制套用到后端。外部门禁只在受信任的 GitLab CI 中按声明追加。

## 执行与复核

执行入口：显式 CI 命令或托管 GitLab Job。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/orchestration/execution-plans.js) · [多应用调度](../../src/orchestration/ci/workspace-runner.js) · [多应用测试](../../test/ci/workspace-ci.test.js)
