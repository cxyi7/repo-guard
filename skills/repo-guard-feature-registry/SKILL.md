---
name: repo-guard-feature-registry
description: 登记或调整 repo-guard 树形功能归属，并判断新需求应新建合同还是修订、修复既有合同。适用于开发或修复开始前的功能识别；不负责生成详细交付合同或执行代码修改。
---

# Repo Guard 功能登记

先读取项目 `repo-guard.config.json` 的 `deliveryContract` 配置，再读取对应功能登记表。不要从目录名称或代码位置直接推断业务归属。

## 工作流

1. 从用户原始需求和本地需求文件提取候选功能名称、目标和边界。
2. 阅读 [references/registry-workflow.md](references/registry-workflow.md)，比较现有树节点和历史合同。
3. 给出父功能、子功能、复用既有功能或新建功能的建议，并明确理由和不确定项。
4. 判断本次应新建合同、修订活动合同，还是建立关联原合同的 repair 合同。
5. 在人工确认前只使用 `proposed`；人工明确确认后才填写 `active`、`confirmedAt` 和 `confirmedBy`。
6. 修改后运行 `repo-guard delivery-contract` 或 `repo-guard doctor`，以 repo-guard 的确定性结果为准。

如果登记表尚不存在，先把 [assets/feature-registry.json](assets/feature-registry.json) 复制到 `deliveryContract.registryPath`；创建节点时再复制 [assets/feature-node.json](assets/feature-node.json) 到目标父节点的 `children`，或复制到根 `features`。两个资产都是故意保持未确认状态的脚手架，必须替换全部 `<REQUIRED_*>` 占位符后再提交。

## 边界

- `children` 与 `deliveryContracts` 始终分开保存，没有内容时使用空数组。
- 不替人工决定有歧义的业务归属。
- 不访问远端需求地址；只把受 Git 跟踪的本地下载文件或截图作为需求事实。
- 不伪造确认人、确认时间或人工结论。
