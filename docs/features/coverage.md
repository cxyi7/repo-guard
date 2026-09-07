# 覆盖率与变更行覆盖率

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

用可复算的测试报告检查全量源码和本次变更是否得到足够验证，帮助定位未覆盖的逻辑。

## 接入与阈值

消费项目应安装与自身 Vitest 版本匹配的覆盖率 provider，并在 Vitest 配置中明确统计源码范围。门禁生成并读取本轮覆盖率报告，检查全量指标及变更行；阈值示例为：

```json
{
  "unitTest": {
    "enabled": true,
    "coverage": {
      "enabled": true,
      "reportsDirectory": "coverage",
      "thresholds": {
        "lines": 80,
        "statements": 80,
        "functions": 80,
        "branches": 80,
        "changedLines": 90
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `unitTest` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用单元测试与资料策略 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 首次 init 会按项目就绪探测启用；表中是补缺默认值。 |
| `coverage.enabled` | 是否启用本轮覆盖率生成与阈值检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；启用命令同时启用 unitTest；父级关闭时不执行。 |
| `coverage.reportsDirectory` | 本轮 coverage-summary.json 与 lcov.info 的专用输出目录 | 字符串<br>默认：`"coverage"` | 至少 1 个字符；末级目录名称必须包含 coverage（不区分大小写）；末级目录名必须含 coverage；Vitest 会清理该专用目录，不能指向源码。 |
| `coverage.thresholds.lines` | 全量行覆盖率最低百分比 | 数值<br>默认：`80` | ≥ 0；≤ 100 |
| `coverage.thresholds.statements` | 全量语句覆盖率最低百分比 | 数值<br>默认：`80` | ≥ 0；≤ 100 |
| `coverage.thresholds.functions` | 全量函数覆盖率最低百分比 | 数值<br>默认：`80` | ≥ 0；≤ 100 |
| `coverage.thresholds.branches` | 全量分支覆盖率最低百分比 | 数值<br>默认：`80` | ≥ 0；≤ 100 |
| `coverage.thresholds.changedLines` | 本次变更行覆盖率最低百分比 | 数值<br>默认：`90` | ≥ 0；≤ 100；依赖可信 Git 变更范围，不是只看全量摘要。 |

<!-- config-fields:end -->

```bash
npx repo-guard enable coverage
npx repo-guard unit-test
```

`enable coverage` 同时启用 `unitTest`。关闭 `unitTest` 会关闭组件交互，但保留 coverage 子配置；父级关闭时不会运行单元测试与覆盖率。报告缺失、格式无效与覆盖率不达标是不同问题，应分别补齐 provider/报告设置或增加有效测试。

## 运行范围与报告

覆盖率跟随完整单元测试，进入手动 `unit-test`、pre-push 和 CI `full`；不进入 pre-commit。CI `policy` 不执行完整测试，`release-ready` 的项目 `test` 脚本是否统计覆盖率由项目脚本决定。

门禁读取本轮执行报告。全量指标分别比较行、语句、函数与分支；变更行指标依赖可信 Git 变更范围，范围错误应先补齐历史或正确的 base/head。

## 修复与复核

阈值不达标时从未覆盖位置增加有结果断言的测试，尤其覆盖分支和异常路径。报告缺失、格式错误、provider 不兼容属于接入问题。不能靠旧报告、缩小统计范围或只调用函数而不验证结果来替代有效测试。

## 维护依据

[实现入口](../../src/gates/testing/coverage-gate.js) · [对应测试](../../test/coverage.test.js)
