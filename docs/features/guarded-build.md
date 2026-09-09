# 受保护构建

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

在指定构建前强制完成变异测试，避免测试无法识别实现错误时仍生成交付产物。

## 配置与调用

先完成[Stryker 接入](mutation-test.md)，在 `checks.mutationTest.guardedBuilds` 声明原始构建与受保护别名。配置片段：

```json
{
  "checks": {
    "mutationTest": {
      "enabled": true,
      "guardedBuilds": [
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
| `checks.mutationTest.guardedBuilds` | 先执行变异测试、通过后再执行指定构建脚本的通用 npm 包装入口 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `checks.mutationTest.guardedBuilds[].script` | 测试通过后执行的原始 npm 构建脚本 | 字符串<br>本对象内必填，无自动代填值 | 仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.mutationTest.guardedBuilds[].packageScript` | 由 repo-guard 生成并供开发者或 CI 调用的新 npm 脚本 | 字符串<br>本对象内必填，无自动代填值 | 以 guard:build: 开头，后续仅字母、数字、冒号、下划线、连字符；作为新入口使用，不能取代已有不同内容的自定义脚本；团队和 CI 需调用该别名。 |
| `checks.mutationTest.guardedBuilds[].timeoutMs` | 原始构建脚本允许执行的最长时间 | 整数<br>默认：`300000` | ≥ 1 |
| `checks.mutationTest.guardedBuilds[].notifyOnFailure` | 变异测试未通过时是否复用已启用的企业微信通知 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

消费项目须已有真实 `build:h5` 脚本。同步托管脚本并检查：

```bash
npx repo-guard init --project web --role frontend --stack node --preset vue-javascript
npx repo-guard doctor
npx repo-guard guarded-build build:h5
```

也可使用生成的 `npm run guard:build:h5`。别名未就绪或被人工替换时先解决冲突。

## 执行和失败处理

顺序是完整变异测试 → 对应原始构建 → 已配置的产物预算检查。变异测试必须为 `passed`；关闭 mutationTest、无可评分变异、报告缺失、得分不足和工具失败都不能启动构建。

失败时修复测试或实现，使 Stryker 能检测错误，重新运行受保护入口。报告位于配置的 mutation 报告目录；失败通知同时受单项 `notifyOnFailure`、全局通知与流水线去重配置约束。

本能力不自动加入固定 Hook 或 CI 计划。原始 `build:h5` 保留且仍能直接调用，团队和 CI 必须选择受保护别名才能获得这层约束。

## 维护依据

[实现入口](../../src/orchestration/cli/guarded-build.js) · [对应测试](../../test/gates/testing/mutation-test.test.js)
