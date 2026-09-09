# 项目构建

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

调用项目声明的构建脚本，确认当前代码能产生交付产物；可进一步检查产物预算。

## 接入与运行

在消费项目准备真实构建脚本，再合并配置片段：

```json
{
  "checks": {
    "build": {
      "enabled": true,
      "script": "build",
      "timeoutMs": 300000
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.build.enabled` | 是否启用项目构建 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.build.script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"build"` | 至少 1 个字符；仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.build.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`300000` | ≥ 1 |

<!-- config-fields:end -->

```bash
npx repo-guard enable build
npx repo-guard doctor
npx repo-guard build
```

初始化按项目准备情况启用；手动入口仍读取开关。项目可以更换 `script`，但不能用空脚本冒充构建。

## 执行与结果

手动、pre-push、CI `full` 与 `release-ready` 按配置执行；不进入 pre-commit。实际构建平台、目录、环境变量与工具链由消费项目提供，repo-guard 负责执行、超时和结果归一。

构建成功后，若启用 `checks.build.artifactBudget`，继续检查[单平台产物预算](build-artifact-budget.md)。构建失败、工具无法启动或超时应根据报告修复，再运行相同入口，不能沿用旧 dist 作为本轮成功证据。

## 与其他能力的关系

需要“变异测试通过才构建”时使用[受保护构建](guarded-build.md)。Lighthouse 配置复用同名构建脚本时可能跳过重复构建，显式检查前应确保当前产物新鲜，详见[Lighthouse](lighthouse.md)。构建通过不会自动部署或发布 npm 包。

## 维护依据

[实现入口](../../src/integrations/npm/build.js) · [对应测试](../../test/gates/quality/build.test.js)
