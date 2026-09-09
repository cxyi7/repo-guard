# 变异测试与受保护构建

运行 Stryker 并按变异得分决定是否执行受保护构建别名。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`；`migrate` 仅用于旧版本显式迁移。

变异测试默认关闭，并且不会进入 pre-commit、pre-push 或固定 CI 计划。消费项目先按 [StrykerJS 官方初始化流程](https://stryker-mutator.io/docs/stryker-js/getting-started/)安装自身需要的 `@stryker-mutator/core` 10.x、测试运行器和 `stryker.config.*`；repo-guard 只调用消费项目的安装与配置，不内置测试运行器。

Stryker 的 `thresholds.break` 是必需的构建硬门槛，必须配置为 0 到 100 之间的数值；缺失时也会阻断构建。repo-guard 强制使用本地 `json`、`html`、`clear-text` 和 `progress` reporter，强制关闭 `inPlace`，不会启用 `dashboard` 或隐式上传报告。每次运行前都会删除旧报告，仅接受本次新生成且符合 Stryker `schemaVersion: "1.0"` 的报告。

```json
{
  "checks": {
    "mutationTest": {
      "enabled": true,
      "configFile": "stryker.config.mjs",
      "timeoutMs": 1800000,
      "reportsDirectory": "reports/mutation",
      "originalHtml": true,
      "guardedBuilds": [
        {
          "script": "build:mp-weixin",
          "packageScript": "guard:build:mp-weixin",
          "timeoutMs": 300000,
          "notifyOnFailure": true
        },
        {
          "script": "build:h5",
          "packageScript": "guard:build:h5",
          "timeoutMs": 300000,
          "notifyOnFailure": true
        }
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.mutationTest.enabled` | 启用变异测试命令以及受保护构建编排 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.mutationTest.configFile` | 消费项目中的 Stryker JS 或 JSON 配置文件 | 字符串<br>默认：`"stryker.config.json"` | 至少 1 个字符；仓库相对路径；不能是绝对路径或含 .. 越界，使用 / 分隔；扩展名为 .cjs、.mjs、.js 或 .json |
| `checks.mutationTest.timeoutMs` | 单次变异测试允许执行的最长时间 | 整数<br>默认：`1800000` | ≥ 1 |
| `checks.mutationTest.reportsDirectory` | 存放 mutation.json、中文 HTML 和可选 Stryker 原始 HTML 的专用目录 | 字符串<br>默认：`"reports/mutation"` | 至少 9 个字符；仓库内 reports/ 路径；使用 / 分隔，禁止父目录越界、反斜线和平台保留名 |
| `checks.mutationTest.originalHtml` | 是否同时生成 Stryker 原始交互 HTML 报告 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.mutationTest.guardedBuilds` | 先执行变异测试、通过后再执行指定构建脚本的通用 npm 包装入口 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `checks.mutationTest.guardedBuilds[].script` | 测试通过后执行的原始 npm 构建脚本 | 字符串<br>本对象内必填，无自动代填值 | 仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.mutationTest.guardedBuilds[].packageScript` | 由 repo-guard 生成并供开发者或 CI 调用的新 npm 脚本 | 字符串<br>本对象内必填，无自动代填值 | 以 guard:build: 开头，后续仅字母、数字、冒号、下划线、连字符；作为新入口使用，不能取代已有不同内容的自定义脚本；团队和 CI 需调用该别名。 |
| `checks.mutationTest.guardedBuilds[].timeoutMs` | 原始构建脚本允许执行的最长时间 | 整数<br>默认：`300000` | ≥ 1 |
| `checks.mutationTest.guardedBuilds[].notifyOnFailure` | 变异测试未通过时是否复用已启用的企业微信通知 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

运行 `npx repo-guard init` 后，repo-guard 会在别名不存在时加入以下脚本，并把报告目录加入受管 `.gitignore`：

```json
{
  "scripts": {
    "guard:mutation-test": "repo-guard mutation-test",
    "guard:build:mp-weixin": "repo-guard guarded-build build:mp-weixin",
    "guard:build:h5": "repo-guard guarded-build build:h5"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `guard:mutation-test` | 项目真实的 repo-guard 执行入口 | 字符串，示例为 `repo-guard mutation-test` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |
| `guard:build:mp-weixin` | 项目真实的 repo-guard 执行入口 | 字符串，示例为 `repo-guard guarded-build build:mp-weixin` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |
| `guard:build:h5` | 项目真实的 repo-guard 执行入口 | 字符串，示例为 `repo-guard guarded-build build:h5` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |

<!-- config-fields:end -->

`guardedBuilds` 可声明任意多个原始 npm 构建脚本，不限于小程序。受保护别名先执行完整变异测试；得分低于 `thresholds.break`、没有可评分变异、Stryker 执行失败、报告缺失或报告无效时都不会运行原始构建。通过后才执行对应的 `script`。原始 `build:*` 脚本保持不变并仍可直接调用，因此团队和 CI 必须改用 `guard:build:*` 才能获得强制保护；`npx repo-guard doctor` 会检查原始脚本和别名是否完整且未被替换。

报告默认写入 `reports/mutation/mutation.json`、中文 `mutation.html` 和可选的 Stryker 原始 `mutation-original.html`。路径必须位于 `reports/`、被 Git 忽略、不得穿过符号链接，也不得覆盖已跟踪文件。`notifyOnFailure` 与全局 `reporting.notification.enabled` 同时开启时，失败会复用现有企业微信配置发送项目、分支、构建脚本、得分、门槛和报告位置；GitLab 受管流水线通知已开启时不会重复发送。

## 执行与复核

执行入口：显式 mutation-test 或 guarded-build；不进入固定 Hook 和 CI 计划。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/testing/mutation-test-platform-gate.js) · [对应测试](../../test/gates/testing/mutation-test.test.js)
