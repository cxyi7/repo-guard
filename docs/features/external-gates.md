# 项目外部门禁

把项目自己的 npm 检查脚本与标准报告接入手动或受信任 CI。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`；`migrate` 仅用于旧版本显式迁移。

消费项目可以通过严格的 npm script 和 `repo-guard-json-v1` 报告接入项目自有检查：

```json
{
  "ci": {
    "externalGates": [
      {
        "id": "project.engineering-review",
        "enabled": true,
        "environments": [
          "manual",
          "ci-full",
          "release-ready"
        ],
        "script": "check:engineering-review",
        "timeoutMs": 120000,
        "report": {
          "format": "repo-guard-json-v1",
          "path": "reports/engineering-review.json"
        }
      }
    ]
  }
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `ci.externalGates` | 项目自有检查的注册列表；每项声明一个门禁 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `ci.externalGates[].id` | 项目门禁唯一 ID，使用 project. 加小写连字符名称 | 字符串<br>本对象内必填，无自动代填值 | 必须使用 project. 前缀，后接小写字母开头的小写字母/数字/连字符名称 |
| `ci.externalGates[].enabled` | 是否启用该项目门禁 | `true` / `false`<br>本对象内必填，无自动代填值 | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `ci.externalGates[].environments` | 允许执行的入口；manual 为手动，ci-full 为完整 CI，release-ready 为发布准备 | 数组；每项可选 `"manual"`、`"ci-full"`、`"release-ready"`<br>本对象内必填，无自动代填值 | 至少 1 项；元素不可重复；CI 仅在受信任 GitLab 受保护分支调度；Axios/k6 runner 进一步只允许 manual。 |
| `ci.externalGates[].script` | 项目 package.json 中的精确脚本名，不是 shell 命令 | 字符串<br>本对象内必填，无自动代填值 | 仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `ci.externalGates[].timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>本对象内必填，无自动代填值 | ≥ 1000；≤ 1800000 |
| `ci.externalGates[].report.format` | 项目脚本输出的报告协议 | 只能为 `"repo-guard-json-v1"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `ci.externalGates[].report.path` | 本轮新生成的外部门禁 JSON 报告路径 | 字符串<br>本对象内必填，无自动代填值 | 仓库内 reports/ 路径；使用 / 分隔，禁止父目录越界、反斜线和平台保留名，以 .json 结尾；必须在 reports/ 内、未跟踪、无符号链接、每轮新生成；命名不能使用平台保留名。 |

<!-- config-fields:end -->

```bash
npx repo-guard external project.engineering-review
```

外部门禁不进入 pre-commit、pre-push 或 CI policy，也不能插入或重排官方计划。声明了 manual 的能力可以通过本地命令显式执行。自动加入 CI full/release-ready 时要求 `GITLAB_CI=true` 且 `CI_COMMIT_REF_PROTECTED=true`；`ci.gatePolicy` 不会绕过这个 CI 条件。Axios 与 k6 runner 另有仅本地手动执行的限制。

## 执行与复核

执行入口：本地手动；声明的 CI full/release-ready 入口仅在可信 GitLab 受保护分支调度。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/testing/external-gate.js) · [对应测试](../../test/gates/testing/external-gate.test.js)
