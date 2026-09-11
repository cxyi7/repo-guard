# 官方 Gate Registry

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

为每个检查提供唯一身份、执行契约和能力目录，确保 CLI、Hook、CI 复用相同判断。

## 如何理解和使用

| 名称 | 示例 | 用途 |
|---|---|---|
| 功能开关 | `pathNaming` | 通过 enable/disable 配置自动执行 |
| 配置位置 | `checks.pathNaming` | 保存阈值、范围与其他选项 |
| Gate ID | `repository.path-naming` | 在计划、CI 策略和报告中定位门禁 |
| 手动命令 | `path-naming` | 从终端显式运行该能力 |

实际名称和手动入口以 Registry 与[使用说明](../usage-guide.md)为准。Registry 包含稳定 ID、支持环境、所需工具、副作用及计划/执行接口；没有手动入口的 Gate 不能靠猜命令运行。

仓库级文件归位使用一组独立标识，避免与应用归位混淆：

| 能力 | 功能开关 | 配置位置 | Gate ID | 手动命令 |
|---|---|---|---|---|
| [仓库级文件归位](repository-file-placement.md) | `repositoryFilePlacement` | `repository.filePlacement` | `repository.global-file-placement` | `repository-file-placement` |
| [应用文件归位](file-placement.md) | `filePlacement` | `checks.filePlacement` | `repository.file-placement` | `file-placement` |

## 执行边界

Registry 声明“有哪些能力”，Execution Plan 声明“这个阶段执行哪些、按什么顺序”。能力支持某环境，不代表它一定进入该环境的每一份固定计划。

CI 计划逐级组合：`full` 复用 `policy` 的完整步骤，再追加项目质量检查；`release-ready` 复用 `full`，追加 Lighthouse 与最终交付证据复核。公共步骤、报告名称和顺序只维护一份，避免新增策略时不同配置档遗漏检查。外部门禁仍按配置环境追加，最终证据复核保持在最后。

消费项目通过公开配置管理能力，用 CI gatePolicy 调整允许的模式；不能替换官方 Gate 或重排计划。自有检查使用[项目外部门禁](external-gates.md)，以 `project.*` ID 追加，并遵守项目脚本和报告契约。

`repository.global-file-placement` 属于仓库公共 Gate，由根配置管理，不归任何前端或后端应用继承。它进入手动、pre-commit、pre-push 和 CI policy/full/release-ready，在每轮公共流程中执行一次；应用筛选、应用例外和应用 Gate 模式不能缩小或豁免检查。配置默认关闭，启用须提供规则，执行只依赖 Git，不移动文件。

该 Gate 的输入是完整仓库路径清单：提交读取完整索引，真实推送和 CI 读取可信 `revision.head` 的完整提交树，手动命令读取工作区受控文件和未忽略文件。它不受应用归位 `mode` 或本轮变更清单限制，不进入 gitlink 子模块内部。结果使用公共 GateResult 和退出码映射。

Java Maven 使用 `java.*` 独立 Gate，配置位于本应用 `checks.javaFormat` 等字段。Node 与 Java 的专用 Gate 按显式技术栈过滤，`ci.gatePolicy` 不会将前端工具强制套用到 Java。Java 源码修复只在暂存事务或显式 `java-format --fix` 中执行；CI 始终只读源码。Maven 检查可以产生构建与测试报告，但不修复源代码。

`java.path-naming` 是独立的完整索引路径检查，进入提交、推送及 CI policy/full/release-ready。`java.spotbugs` 与 `java.mutation-test` 是独立的 Maven 工具检查，只进入手动、推送、CI full/release-ready，不进入提交或 CI policy。对应开关、Doctor、托管 AI 规范、应用选择及统一退出码均从正式 Registry 与配置接入；Gradle 不在本轮适配范围。

Java 实际工具验证范围与未覆盖条件见 [Java 检查验收记录](../java-check-acceptance.md)。

## 维护与复核

新增或调整官方能力时同步元数据、执行计划、配置与对应测试，更新功能索引和本功能手册。重点核对支持环境与真实计划是否一致，以及是否改变副作用、输入范围或报告含义。未知 Gate、错误环境或无效契约应修复注册/配置问题，不能默默跳过。

## 维护依据

[实现入口](../../src/gates/registry.js) · [对应测试](../../test/core/gate-capability.test.js)

[执行计划](../../src/orchestration/execution-plans.js) · [计划顺序回归](../../test/core/execution-plan.test.js)
