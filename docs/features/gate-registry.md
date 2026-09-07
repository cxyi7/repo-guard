# 官方 Gate Registry

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

为每个检查提供唯一身份、执行契约和能力目录，确保 CLI、Hook、CI 复用相同判断。

## 如何理解和使用

| 名称 | 示例 | 用途 |
|---|---|---|
| 功能开关 | `pathNaming` | 通过 enable/disable 配置自动执行 |
| 配置位置 | `preCommit.pathNaming` | 保存阈值、范围与其他选项 |
| Gate ID | `repository.path-naming` | 在计划、CI 策略和报告中定位门禁 |
| 手动命令 | `path-naming` | 从终端显式运行该能力 |

实际名称和手动入口以 Registry 与[使用说明](../usage-guide.md)为准。Registry 包含稳定 ID、支持环境、所需工具、副作用及计划/执行接口；没有手动入口的 Gate 不能靠猜命令运行。

## 执行边界

Registry 声明“有哪些能力”，Execution Plan 声明“这个阶段执行哪些、按什么顺序”。能力支持某环境，不代表它一定进入该环境的每一份固定计划。

消费项目通过公开配置管理能力，用 CI gatePolicy 调整允许的模式；不能替换官方 Gate 或重排计划。自有检查使用[项目外部门禁](external-gates.md)，以 `project.*` ID 追加，并遵守项目脚本和报告契约。

## 维护与复核

新增或调整官方能力时同步元数据、执行计划、配置与对应测试，更新功能索引和本功能手册。重点核对支持环境与真实计划是否一致，以及是否改变副作用、输入范围或报告含义。未知 Gate、错误环境或无效契约应修复注册/配置问题，不能默默跳过。

## 维护依据

[实现入口](../../src/gates/registry.js) · [对应测试](../../test/gate-capability.test.js)
