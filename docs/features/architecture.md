# dependency-cruiser 架构检查

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

用模块依赖图检查循环依赖、无法解析的导入和团队分层边界。

## 接入与配置

消费项目准备 dependency-cruiser `>=16 <19` 和源码目录，按项目需要配置 TS 别名。配置片段：

```json
{
  "checks": {
    "architecture": {
      "enabled": true,
      "sourcePaths": [
        "src"
      ],
      "timeoutMs": 120000,
      "tsConfig": null
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.architecture.enabled` | 是否启用模块架构检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.architecture.sourcePaths` | 交给 dependency-cruiser 分析的仓库相对源码文件、目录或 glob | 字符串数组<br>默认：`["src"]` | 至少 1 项；每项为非空字符串 |
| `checks.architecture.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`120000` | ≥ 1 |
| `checks.architecture.tsConfig` | 用于解析 TypeScript 路径别名的配置；null 时自动使用已存在的 tsconfig.json | 字符串 / null<br>默认：`null` | 非 null 时：至少 1 个字符 |

<!-- config-fields:end -->

```bash
npx repo-guard enable architecture
npx repo-guard doctor
npx repo-guard architecture
```

未覆盖 `rules` 时使用默认规则：禁止循环、无法解析的导入、生产源码导入测试模块。自定义 `rules` 会替换数组，维护分层规则时应同时保留所需基础约束。

## 执行与处理

手动、pre-push 和 CI `full` / `release-ready` 分析配置的源码依赖图；不进入 pre-commit。推送范围用于其他增量策略，不把架构分析自动缩减为几个改动文件。

`error` 级别违规导致阻断，报告包含依赖端点或循环链。循环依赖应提取共享低层模块，导入无法解析时修正路径、包或 tsconfig，生产代码依赖测试时调整职责。工具执行、报告解析和超时失败需先恢复分析能力，再重新运行门禁。

repo-guard 使用消费项目 dependency-cruiser 执行分析，不承诺理解所有业务架构约束；需要团队将实际边界写入规则并通过评审维护。

## 维护依据

[实现入口](../../src/gates/quality/architecture-gate.js) · [对应测试](../../test/gates/quality/architecture.test.js)

## 前端初始化模板

前端初始化的开关、目录、规则及新增字段见[前端维护预设](frontend-maintenance-presets.md)；既有项目读取配置不会被自动改写。

## Node 新建预设

7.1.4 起本项在新建 Node 后端配置中默认开启（类型检查仅限 node-typescript）。原有规则、阈值与配置字段不变；已有项目不因读取或升级而开启。实际工具、脚本和检查范围仍需接入准备，见 [Node 后端规范](node-backend.md)。

本项可关联应用的[目录职责与路径绑定](directory-roles.md)。新建预设的已绑定范围随目录引用解析，用户显式路径优先；原生工具配置须按接入规则单独核对。职责说明不代表业务语义已验证。
