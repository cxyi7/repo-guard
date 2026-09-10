---
name: repo-guard-contract-execution
description: 按已确认的 repo-guard 独立共同合同或仓库内合同包执行开发与真实检查，保留参与方、路径、分支和证据边界。适用于确认后的实现阶段；不负责改变未确认范围或代替最终验收。
---

# Repo Guard 合同执行

## 先选择配置入口

存在 `repo-guard.delivery.json` 时校验当前 `version: 2` 绑定并使用独立模式；关闭时保留资料，不自动切换交付入口。否则按工程配置的 `repository.deliveryContract` 使用仓库内合同包。两个入口不能同时启用，旧或未知格式直接报告，不转换或覆盖。

## 独立共同合同模式

1. 读取绑定及固定合同副本，运行 `repo-guard delivery check`。确认签署定义、修订、当前分支、基线、本仓参与方及任务范围；不得仅凭人工编写的完成状态继续执行。
2. 只实现本方任务，路径相对参与方目录；重命名需要同时检查旧、新路径。工程检查按应用配置执行，前端规则不得为了本次后端任务临时套用或关闭。
3. 代码与配置提交后，保持工作区干净且 HEAD 稳定，再执行 `repo-guard delivery run --participant <id> --check <id>`。同仓有多个参与方时明确选择，检查必须已经在合同中声明。
4. `kind: gate` 使用本方实际工程结果，`kind: command` 使用声明程序。只有实际通过才能满足必需项；关闭、跳过、删测试、降低阈值或手改签名证据均不能代表完成。普通 CI 自动记录工程 Gate 证据时仍需正确的 runner 密钥与参与方绑定。
5. 以 `delivery status` 查看已完成和待处理内容。本方工程检查通过时，可报告本方完成及仍等待的其他参与方、联调或人工验收，不能提前宣布整体交付完成。
6. 真实失败触发反馈流程；定义或任务范围需要变化时返回权威合同来源修订，重新取得人工确认并同步各方。

AI 可以使用授权的执行入口产生 runner 签名结果，不读取、复制或使用人工 reviewer 私钥，不代签 `delivery approve / accept`。报告和执行私钥留在忽略目录；不能把另一人的私钥写进代码或日志。

## 仓库内合同包模式

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
