# 单文件行数

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

控制单个文件的规模，在接近上限时提示拆分，避免职责持续堆积。

## 配置

默认启用，Vue 上限 700 行，JS/TS 系列上限 1000 行，达到上限的 85% 开始提醒。配置片段：

```json
{
  "preCommit": {
    "maxFileLines": {
      "enabled": true,
      "mode": "strict",
      "warnAt": 0.85,
      "rules": [
        {
          "pattern": "**/*.vue",
          "maxLines": 700
        },
        {
          "pattern": "**/*.{js,ts}",
          "maxLines": 1000
        }
      ],
      "exclusions": []
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `preCommit.maxFileLines` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用单文件行数限制 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `mode` | strict 超限即失败；noRegression 允许历史超限不再增长，新文件仍严格检查 | `"strict"` / `"noRegression"`<br>默认：`"strict"` | 只接受列出的值 |
| `warnAt` | 达到 maxLines 的该比例时提醒；0.85 表示 85%，提醒本身不阻断 | 数值<br>默认：`0.85` | > 0；≤ 1 |
| `rules` | 按文件类型声明物理行数上限，使用第一条匹配规则 | 对象数组；对象字段见后续行<br>默认：内置 3 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项 |
| `rules[].pattern` | 需要限制行数的仓库相对文件 glob | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `rules[].maxLines` | 允许的物理行数上限，包含注释和空行 | 整数<br>本对象内必填，无自动代填值 | ≥ 1 |
| `exclusions` | 匹配后不参与行数检查的路径，优先于行数规则 | 字符串数组<br>默认：`[]` | 允许空数组；每项为非空字符串 |

<!-- config-fields:end -->

示例数组只列出 Vue、JS、TS，项目使用其他扩展名时需保留对应规则。

| 模式 | 如何判断 |
|---|---|
| `strict` | 当前文件超过规则上限即违规 |
| `noRegression` | 与 Git 基线比较，既有超限且未增加可保留告警；新文件超限或既有超限继续增长会阻断 |

## 执行与复核

行数按物理行计算，注释和空行也计入，末尾换行不额外多算一行；Vue 还提供各区块的行数信息。提交入口检查对应暂存内容，CI 三档按所选变更范围复核。没有独立的 `max-file-lines` 手动命令。

超限时按职责提取组件、函数或模块，并补齐调用关系与回归验证。不要只删除必要注释或压成一行满足阈值。使用 `noRegression` 时必须有可解析的真实 Git 基线；修复后重新暂存并通过提交或 CI 复核。

## 维护依据

[实现入口](../../src/policies/max-file-lines.js) · [对应测试](../../test/max-file-lines.test.js)
