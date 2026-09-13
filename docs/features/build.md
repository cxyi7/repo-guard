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
| `checks.build.enabled` | 是否启用项目构建 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 前端显式预设默认开启；需准备实际工具。 |
| `checks.build.script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"build"` | 至少 1 个字符；仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.build.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`300000` | ≥ 1 |

<!-- config-fields:end -->

```bash
npx repo-guard enable build
npx repo-guard doctor
npx repo-guard build
```

前端首次初始化默认开启构建、产物预算和包体积分析，详见[前端性能预设](frontend-performance-presets.md)；手动入口仍读取开关。项目可以更换 `script`，但不能用空脚本冒充构建。

## 执行与结果

启用 `checks.stylelint.uiTokens.artifacts` 时，构建前完整执行 Token 源码约定检查，构建后核对生成 CSS 的指定定义和值。该能力要求明确的来源、输出映射、产物预算及精确清理脚本；手动构建、CI、Lighthouse 前置构建及受保护构建共用同一检查。Token 检查失败不登记可复用构建证据，详见[指定值配置](ui-token-values.md)。

手动、pre-push、CI `full` 与 `release-ready` 按配置执行；不进入 pre-commit。实际构建平台、目录、环境变量与工具链由消费项目提供，repo-guard 负责执行、超时和结果归一。

构建成功后，若启用 `checks.build.artifactBudget`，继续检查[单平台产物预算](build-artifact-budget.md)。构建失败、工具无法启动或超时应根据报告修复，再运行相同入口，不能沿用旧 dist 作为本轮成功证据。

## 与其他能力的关系

需要“变异测试通过才构建”时使用[受保护构建](guarded-build.md)。Lighthouse 仅在同轮输入和产物指纹均一致时复用已通过构建，详见[Lighthouse](lighthouse.md)。构建通过不会自动部署或发布 npm 包。

## 维护依据

[实现入口](../../src/integrations/npm/build.js) · [对应测试](../../test/gates/quality/build.test.js)

## Node 新建预设

7.1.4 起本项在新建 Node 后端配置中默认开启（类型检查仅限 node-typescript）。原有规则、阈值与配置字段不变；已有项目不因读取或升级而开启。实际工具、脚本和检查范围仍需接入准备，见 [Node 后端规范](node-backend.md)。

本项可关联应用的[目录职责与路径绑定](directory-roles.md)。新建预设的已绑定范围随目录引用解析，用户显式路径优先；原生工具配置须按接入规则单独核对。职责说明不代表业务语义已验证。
