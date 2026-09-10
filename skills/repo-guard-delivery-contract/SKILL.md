---
name: repo-guard-delivery-contract
description: 创建或修订 repo-guard 的独立共同合同，或仓库内 schemaVersion 2 多文件合同包。适用于开发前的共同需求、参与方、任务、检查和边界规划；不负责执行实现或最终验收。
---

# Repo Guard 交付合同

## 先选择配置入口

存在 `repo-guard.delivery.json` 时先校验当前 `version: 2` 绑定并使用独立模式；关闭时保留资料，不自动改用另一入口。否则读取 `repo-guard.config.json` 的 `repository.deliveryContract`。两个入口不能同时启用，发现冲突报告并保留文件，不自动转换。

## 独立共同合同模式

1. 阅读绑定指向的固定合同副本，以及已安装包的 `docs/features/delivery-contract.md` 和两个 delivery Schema。无现有绑定且用户已授权接入时，用 `delivery init` 准备未确认草案；执行密钥和验收公钥必须来自团队实际安排，不能伪造。
2. 确定一个权威合同来源。填写稳定 `id`、递增 `revision`、共同 `requirements` 与验收标准；参与方显式声明 `id / repositoryId / role / root / baselineCommit / workingBranch / publicKey`。同仓参与方目录不得重叠，不以技术栈或本机绝对路径识别参与方。
3. 按参与方拆分任务，使用 `requirementIds / allowedPaths / checks` 关联需求、允许修改范围和必需验证。工程可以分别开启，Java、Python 参与者无需虚构 Node 预设。
4. 检查使用 `kind: gate` 引用实际只读工程 Gate，或 `kind: command` 声明团队已有命令、参数和超时。命令须真实检查目标；不自动生成业务测试或用永远成功的占位命令代替。计划用于反馈闭环的检查声明准确的 `testFiles`。
5. 多参与方声明联合命令、覆盖参与方和受信执行公钥。联合程序必须针对传入版本组合运行并输出本轮观察报告；不能仅抄写目标版本后声称联调已经通过。
6. 修改定义后提高修订、清除旧确认，把完整定义交给人工负责人。负责人在本机执行 `delivery approve`；AI 不读取、复制或使用 reviewer 私钥，也不冒充人工运行批准或验收签名。
7. 同步各方固定副本后各自执行 `delivery bind --contract <本仓路径> --participant <本方标识>`；同仓多个参与方用逗号连接。通过 `delivery check` 复核，每仓保留自己的基线与分支，不自动拉取或修改另一仓库。

签名防止已收集证据被篡改并识别受信签署方，不代替对需求、执行命令、密钥授权和业务验收的审查。

## 仓库内合同包模式

输出一个逻辑合同、多个物理文件。主合同只保存身份、仓库边界、资料计划、确认和证据索引；增长型需求事实、追踪关系、执行清单和每个正式发现必须位于组成文件中。

## 工作流

1. 确认功能登记表中的 `featureId` 已由人工确认且状态为 `active`。
2. 阅读 [references/contract-workflow.md](references/contract-workflow.md) 和已安装包中的 `node_modules/@cxyi7/repo-guard/docs/features/delivery-contract.md`。
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
