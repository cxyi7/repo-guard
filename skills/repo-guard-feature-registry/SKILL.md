---
name: repo-guard-feature-registry
description: 按实际交付入口整理独立共同合同的需求归属，或登记仓库内合同包的树形功能归属，并判断新建或修订合同。适用于开发或修复开始前的功能识别；不负责详细合同规划或代码修改。
---

# Repo Guard 功能登记

## 先选择配置入口

检查仓库是否存在 `repo-guard.delivery.json`。存在时先读取并校验当前 `version: 2` 绑定，使用下方独立模式；关闭时保留资料，不把它自动转成仓库内合同包。未使用独立入口时，再读取工程配置的 `repository.deliveryContract`。两种入口不能同时启用，遇到冲突应报告并保留原文件。独立模式不要求 Node 工程身份或 `package.json`。

## 独立共同合同模式

1. 读取绑定指向的固定合同副本，核对 `id / revision / contractDigest` 与本仓 `participants`；具体字段以已安装包的 `docs/features/delivery-contract.md`、`delivery.schema.json` 和 `delivery-contract.schema.json` 为准。
2. 从用户提供的需求整理 `requirements`，保留稳定需求标识、描述和可验收标准。比较已有需求与历史修订，不根据目录或后端语言推断业务归属。
3. 把需求分配到前端或后端参与方的 `tasks[].requirementIds`，明确 `repositoryId`；一个需求可由多方协作，每个需求都应有任务覆盖。无需额外创建仓库内功能树或 Markdown 合同包。
4. 只在团队指定的权威合同来源起草变更；修改定义后提高修订并交给人确认，再同步各方固定副本、重新 `repo-guard delivery bind`。不能让各仓自行修改成不同合同仍声称同一交付。
5. 使用 `repo-guard delivery check` 复核当前定义、身份和边界；草案未确认时保留待确认结论。由验收负责人在本机执行 `delivery approve`，AI 不读取、复制或使用 reviewer 私钥，不代签批准。

工程规则归各应用所有，共同需求归合同管理；分仓或不同电脑不要求分支同名，不引用另一台机器的绝对目录作为参与方身份。

## 仓库内合同包模式

先读取仓库 `repo-guard.config.json` 的 `repository.deliveryContract` 配置，再读取对应功能登记表；多应用也使用仓库公共配置。项目配置必须为 `version: 2`，功能登记表必须为 `schemaVersion: 2`，旧格式停止处理并交由人工按当前规范重新建立，不自动转换。不要从目录名称或代码位置直接推断业务归属。

## 工作流

1. 从用户原始需求和本地需求文件提取候选功能名称、目标和边界。
2. 阅读 [references/registry-workflow.md](references/registry-workflow.md)，比较现有树节点和历史合同。
3. 给出父功能、子功能、复用既有功能或新建功能的建议，并明确理由和不确定项。
4. 判断本次应新建合同、修订活动合同，还是建立关联原合同的 repair 合同。
5. 在人工确认前只使用 `proposed`；人工明确确认后才填写 `active`、`confirmedAt` 和 `confirmedBy`。
6. 修改后运行 `repo-guard delivery-contract` 或 `repo-guard doctor`，以 repo-guard 的确定性结果为准。

如果登记表尚不存在，先把 [assets/feature-registry.json](assets/feature-registry.json) 复制到 `repository.deliveryContract.registryPath`；创建节点时再复制 [assets/feature-node.json](assets/feature-node.json) 到目标父节点的 `children`，或复制到根 `features`。两个资产都是故意保持未确认状态的脚手架，必须替换全部 `<REQUIRED_*>` 占位符后再提交。

## 边界

- `children` 与 `deliveryContracts` 始终分开保存，没有内容时使用空数组。
- 不替人工决定有歧义的业务归属。
- 不访问远端需求地址；只把受 Git 跟踪的本地下载文件或截图作为需求事实。
- 不伪造确认人、确认时间或人工结论。
