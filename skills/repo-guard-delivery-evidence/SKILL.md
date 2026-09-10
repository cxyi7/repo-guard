---
name: repo-guard-delivery-evidence
description: 复核 repo-guard 独立共同合同的参与方签名证据、联合版本组合和人工验收，或仓库内合同包的 Evidence Run。适用于准备验收或发布的阶段；不负责实现功能或代替人工验收。
---

# Repo Guard 交付证据

## 先选择配置入口

存在 `repo-guard.delivery.json` 时校验当前 `version: 2` 绑定并使用独立模式；关闭时保留资料，不自动切换入口。否则按 `repository.deliveryContract` 使用仓库内合同包。两个入口不能同时启用；签名 JSON 证据与 Markdown Evidence Run 不相互代替。

## 独立共同合同模式

1. 核对固定合同副本、修订和已确认指纹，运行 `repo-guard delivery status`。参与方身份必须包含稳定 `repositoryId`，不同仓库不要求相同提交号或分支名。
2. 使用实际 `delivery run` 或本方 CI 工程 Gate 生成签名证据。每个必需检查必须实际通过；`skipped`、配置关闭、未运行以及另一应用的同名 Gate 均不能当作本方完成。
3. 通过 `delivery import --from <文件>` 导入各方结果，不改写载荷和签名。核对合同指纹、检查定义、参与方身份和代码提交；本仓证据必须对应当前干净 HEAD。
4. 按合同执行 `delivery integrate --check <检查标识> --key-file <联合执行密钥路径>`。联合程序读取 `REPO_GUARD_DELIVERY_BASELINE` 与 `REPO_GUARD_DELIVERY_BASELINE_DIGEST`，针对明确的版本组合执行，并在 `REPO_GUARD_DELIVERY_REPORT` 写出本轮实际观察报告。
5. 报告包含 `version: 2`、`status: passed`、`baselineDigest` 与完整 `subjects`，必须与目标一致。缺失、复用旧报告或版本不同不能通过；不能仅复制目标字段而没有真实联合验证。
6. 技术证据齐全后把版本组合、真实结果和待确认事项交给人工负责人。人工完成实际验收后在本机执行 `delivery accept`；AI 不读取、复制或使用 reviewer 私钥，不代替人签署，也不伪造确认身份。
7. 运行 `delivery verify`，仅当它复核通过才报告该版本组合已满足合同。`delivery status` 的成功退出只表示状态查询完成，不等于交付通过。改变代码版本、合同或证据后重新验证联合结果与验收，不能沿用旧签名结论。

存在反馈时同时核对相同检查定义、相同测试内容在问题版本失败和修复版本通过，以及改进义务已通过。签名识别受信执行方并保护传输完整性，不自动证明远端部署真实状态或业务正确；本机也不会获知尚未导入的新提交。此流程不执行发布或部署。

## 仓库内合同包模式

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
