---
name: repo-guard-contract-execution
description: 按已确认的 repo-guard 交付合同执行开发、测试和清单更新，并控制路径、分支、Worktree 与并行合同风险。适用于合同确认后的实现阶段；不负责改变未确认范围或给出最终 release-ready 结论。
---

# Repo Guard 合同执行

开始前读取主合同及其 requirements、traceability、obligations 和已有 findings 组成文件。阅读 [references/execution-workflow.md](references/execution-workflow.md) 后再修改代码。

## 工作流

1. 运行 `repo-guard delivery-contract`，确认合同唯一、分支和基线一致。
2. 按任务顺序实施，只修改 `allowedPaths`，并把 `forbiddenPaths` 作为更高优先级约束。
3. 重命名同时检查旧、新路径；复制检查目标路径和禁止范围。
4. 每完成一个 AI 项，先形成可复核证据，再勾选 `obligations.md`。
5. Gate 项只能在对应 Gate 实际通过并形成证据后勾选。
6. 测试发现推翻完成状态时，调用反馈流程并重新打开关联任务。
7. 定义或范围发生变化时停止实现，返回合同规划阶段并等待人工重新确认。

## 边界

- 不勾选尚未完成或没有证据的事项。
- 不填写人工确认项。
- 不在普通 Git Hook 中运行项目级 fix。
- 不把最终 Evidence Run 当作开发过程日志。
