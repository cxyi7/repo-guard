---
name: repo-guard-delivery-contract
description: 为 repo-guard 已确认归属的功能创建或修订 schemaVersion 2 多文件交付合同包。适用于开发前的 Spec、设计、任务、示例、视觉参考和边界规划；不负责执行实现或最终发布验收。
---

# Repo Guard 交付合同

输出一个逻辑合同、多个物理文件。主合同只保存身份、仓库边界、资料计划、确认和证据索引；增长型需求事实、追踪关系、执行清单和每个正式发现必须位于组成文件中。

## 工作流

1. 确认功能登记表中的 `featureId` 已由人工确认且状态为 `active`。
2. 阅读 [references/contract-workflow.md](references/contract-workflow.md) 和已安装包中的 `node_modules/@cxyi7/repo-guard/docs/contract-driven-delivery.md`。
3. 从本地下载文件或截图建立当前需求修订，不覆盖旧修订。
4. 生成 Spec、Design、Tasks、Examples、Visuals 资料计划；按实际需要使用 `inline`、`file`、`reference` 或 `not-needed`。
5. 创建 `schemaVersion: 2` 合同包。把 [assets/contract-bundle/contract.md](assets/contract-bundle/contract.md) 复制到 `<contractsDirectory>/<contractId>.md`，把 `requirements.md` 复制到 `<contractsDirectory>/<contractId>/requirements/rev-001/requirements.md`，再把 `traceability.md`、`obligations.md` 复制到 `<contractsDirectory>/<contractId>/`。这些资产故意包含不可通过 Gate 的 `<REQUIRED_*>` 和 `pending`，必须逐项替换，不能直接作为已确认合同提交。
6. 规划 `allowedPaths`、`forbiddenPaths`、分支、基线、目标分支、Worktree 和并行合同协调。
7. 运行 `repo-guard delivery-contract`，使用报告中的实际指纹更新合同。
8. 向人工展示完整定义和未决问题；人工确认后才清空 `blockingQuestions`、填写确认身份与时间并勾选 `HUMAN-PLAN-*`。
9. 在已确认功能节点的 `deliveryContracts` 中追加唯一的 `{ "id": "<contractId>", "path": "<contractsDirectory>/<contractId>.md" }`，再运行 Gate 复核双向绑定。

## 边界

- 不根据 Git commit type 推断合同类型。
- 不机械要求固定数量的资料文件。
- 不把 requirements、traceability、obligations 或 FND 正文重新塞回主合同。
- 定义变化必须提升连续修订并重新人工确认。
- 不伪造人工确认。
