# TypeScript 类型检查

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

调用消费项目的类型脚本，检查静态类型是否一致，适用于 TypeScript 和有类型检查配置的 Vue 项目。

## 接入

先在项目提供真实 `typecheck` 脚本，使用项目自己的 TypeScript 或 vue-tsc 及配置。配置片段：

```json
{
  "typeCheck": {
    "enabled": true,
    "script": "typecheck",
    "timeoutMs": 180000
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `typeCheck` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用TypeScript 或 Vue 类型检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 首次 init 会按项目就绪探测启用；表中是补缺默认值。 |
| `script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"typecheck"` | 至少 1 个字符；仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`180000` | ≥ 1 |

<!-- config-fields:end -->

```bash
npx repo-guard enable typeCheck
npx repo-guard doctor
npx repo-guard typecheck
```

初始化探测到可用脚本时启用；显式手动命令也读取功能开关。不存在或为空的脚本属于配置错误。

## 范围与结果

手动、pre-push 和 CI `full` 调用项目脚本，实际检查范围由该脚本及 tsconfig 决定，通常是全项目。不进入 pre-commit；`release-ready` 不单列类型步骤，需要项目 `check` 脚本明确包含。

脚本成功结束才表示当前入口通过。非零退出时阅读中文主结论与标明来源的工具原始诊断，修正接口、类型定义、调用或配置；超时和启动失败先处理环境。重新执行相同入口，不用忽略类型错误替代修复。

## 维护依据

[实现入口](../../src/integrations/npm/typecheck.js) · [对应测试](../../test/typecheck.test.js)
