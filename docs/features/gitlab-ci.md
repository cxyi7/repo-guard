# GitLab CI 与逐 Gate 策略

用固定配置档复核可信 Git 范围，并保存结构化报告。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

安装或检查 CI：

```bash
npx repo-guard install-ci --provider gitlab --profile policy --dry-run
npx repo-guard install-ci --provider gitlab --profile policy
npx repo-guard doctor --ci
```

显式执行：

```bash
npx repo-guard ci --profile policy --base <sha> --head <sha>
npx repo-guard ci --profile full --base <sha> --head <sha>
npx repo-guard ci --profile release-ready --base <sha> --head <sha>
```

| 配置档 | 内容 |
|---|---|
| `policy` | 结构化例外、AGENTS、提交信息、异步资源、路径命名、UI Token、安全与基础可访问性、依赖、文件归位、图片、代码位置、行数、交付合同、单元测试资料策略、保护文件 |
| `full` | `policy` 加只读 Stylelint、ESLint、Prettier、类型检查、Knip、无效图片、完整单元测试/覆盖率、axe、架构和构建 |
| `release-ready` | `policy` 加无效图片、项目 `check`、项目 `test`、构建、可选 Lighthouse、发布包一致性检查和最终交付证据复核 |

CI 不执行源码 fix、不安装 Hook、不读取本地企业微信凭据；测试、构建和报告仍会生成产物。只有显式启用的托管流水线通知会读取 GitLab CI 受保护变量并发送结果。

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
**字段说明**（以下字段位于 `ci` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用CI 门禁流程 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `profile` | policy 检查仓库策略；full 加入完整质量检查；release-ready 复核发布准备 | `"policy"` / `"full"` / `"release-ready"`<br>默认：`"policy"` | 只接受列出的值 |
| `reportPath` | 整体 CI JSON 报告的仓库相对路径 | 字符串<br>默认：`"reports/repo-guard.json"` | 仓库相对 reports/*.json 路径；必须在 reports/ 下以 .json 结尾，不覆盖已跟踪文件，不经过符号链接。 |
| `protectedFiles.action` | report 报告受保护变更；fail 阻断此类变更；block 级规则始终阻断 | `"report"` / `"fail"`<br>默认：`"report"` | 只接受列出的值 |
| `gatePolicy.defaultMode` | inherit 继承功能配置；off 跳过；report 执行但不阻断；enforce 执行并按失败阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>默认：`"inherit"` | 只接受列出的值 |
| `gatePolicy.gates.security.dynamic-code.mode` | 覆盖该 Gate 的 CI 模式：继承、跳过、只报告或强制阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `gatePolicy.gates.security.dynamic-code.scope` | 该 Gate 的检查范围；changed-files 只可用于 Registry 声明支持的能力 | `"all-files"` / `"changed-files"`<br>默认：`"all-files"` | 只接受列出的值 |
| `gatePolicy.gates.accessibility.vue-image-alt.mode` | 覆盖该 Gate 的 CI 模式：继承、跳过、只报告或强制阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `gatePolicy.gates.repository.maximum-file-lines.mode` | 覆盖该 Gate 的 CI 模式：继承、跳过、只报告或强制阻断 | `"inherit"` / `"off"` / `"report"` / `"enforce"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |

<!-- config-fields:end -->

| 模式 | CI 行为 |
|---|---|
| `inherit` | 沿用 Gate 原有 `enabled` 配置，失败会阻断 CI |
| `off` | 在 setup 和执行之前跳过该 CI Gate，不阻断 CI |
| `report` | 仅在隔离的 CI 上下文中启用并执行，失败写入步骤报告但不阻断 CI |
| `enforce` | 仅在隔离的 CI 上下文中启用并执行，失败阻断 CI |

`scope` 默认为 `all-files`。只有 Registry 明确声明支持文件范围的 Gate 才能使用 `changed-files`；不支持的组合会作为配置错误失败，而不是静默缩小检查范围。

`full` 与 `release-ready` 不是逐级包含；项目 `check` 与 `test` 应明确承担发布前所需的验证。外部门禁只在受信任的 GitLab CI 中按声明追加。

## 执行与复核

执行入口：显式 CI 命令或托管 GitLab Job。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/orchestration/execution-plans.js) · [对应测试](../../test/ci.test.js)
