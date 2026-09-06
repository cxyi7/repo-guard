---
name: repo-guard-delivery-evidence
description: 为已完成实现的 repo-guard 合同生成并复核 Evidence Run、提交绑定、GateResult、执行日志和人工验收。适用于准备验收或发布的阶段；不负责实现功能或代替人工验收。
---

# Repo Guard 交付证据

只在合同定义稳定、实现和技术验证完成后生成最终证据。阅读 [references/evidence-workflow.md](references/evidence-workflow.md)，并以 `repo-guard delivery-evidence` 和 `repo-guard ci --profile release-ready` 的结果为准。

## 工作流

1. 确定最终 `subjectCommit` 和最新目标分支提交。
2. 目标分支发生漂移时生成可由 Git 复算的影响分析并等待人工确认。
3. 将需要长期复核的执行报告保存为受 Git 跟踪文件。
4. 从 [assets/evidence-run.md](assets/evidence-run.md) 创建本轮 Evidence Run，并从 [assets/delivery-evidence.yaml](assets/delivery-evidence.yaml) 向主合同添加索引。两个资产中的 `<REQUIRED_*>` 和 `pending` 故意不能通过 Gate。
5. 先运行一次 `repo-guard ci --profile release-ready --report-json reports/release-ready-evidence.json`，从报告的 `steps[*].gateResult` 取得本轮前序 GateResult；此轮允许最后的证据 Gate 因证据尚未完成而失败。把合同清单实际引用的完整 GateResult、执行日志和 `EVD-*` 写入 Evidence Run。CI 报告保持未跟踪，只有整理后的 Evidence Run 和显式证据文件进入 Git。
6. 运行 `repo-guard delivery-evidence`，按报告更新 Evidence Run 指纹和 `technicalEvidenceDigest`；此时 `HUMAN-ACCEPT-*` 尚未勾选，`executionDigest` 只能视为预备值。
7. 人工在最终提交、当前定义指纹和当前技术证据指纹上验收后，填写并勾选 `HUMAN-ACCEPT-*`。
8. 再次运行 `repo-guard delivery-evidence`，因为人工清单状态属于执行摘要输入，必须把报告中的最终值写入 `executionDigest`，然后提交允许的证据元数据。
9. 再次运行 `repo-guard ci --profile release-ready`；最终一轮会重新执行前序 Gate，并逐项比较当前 GateResult 与 Evidence Run。存在未勾选事项、未关闭发现、结果变化或证据漂移时不得宣称可发布。

## 边界

- 不用手写说明代替结构化证据。
- 不复用旧轮次 GateResult 冒充本轮结果。
- 不在代码或合同定义继续变化后沿用旧验收。
- 不代替人工填写验收身份、时间和结论。
