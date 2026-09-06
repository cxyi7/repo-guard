---
name: repo-guard-delivery-feedback
description: 将 AI 自测、CI、测试环境、人工验收或生产反馈转化为 repo-guard FND 闭环和反向升级决定。适用于问题推翻完成状态、暴露合同遗漏或需要永久回归时；不用于记录普通开发中间失败。
---

# Repo Guard 交付反馈

每个正式问题使用一个独立 `findings/FND-*.md` 文件，避免主合同和单一发现文件持续膨胀。开始前阅读 [references/feedback-workflow.md](references/feedback-workflow.md)。

## 工作流

1. 判断问题是否达到正式 FND 条件；普通中间失败只保存在执行日志。
2. 从 [assets/finding.md](assets/finding.md) 创建独立发现文件，先把 `<REQUIRED_FINDING_ID>` 替换为本合同中全局唯一的 `FND-*`，再记录发现者、阶段、问题提交、关联任务和重复特征。资产中的 `pending` 故意不能通过最终 Gate。
3. 未进入终态时重新打开关联任务。
4. 实现缺陷保存同一回归测试在问题提交失败、最终代码提交通过的红—绿证据。
5. 测试环境或人工验收反馈按参考中的变体记录实际部署提交和 `HUMAN-RETEST-*` 人工复测；拒绝或延期按另一变体记录调查、关闭原因和人工确认。
6. 分别分析测试、合同、设计、任务模板和 Gate 是否升级，并等待人工确认升级决定。
7. 已关闭合同的问题建立新的 `repair` 合同，不篡改原合同完成历史。

## 边界

- 不把每个问题都升级成全局 Gate。
- 不删除或覆盖进入 Git 历史的 FND。
- 不代替人工确认拒绝、延期、升级结论或复测结果。
