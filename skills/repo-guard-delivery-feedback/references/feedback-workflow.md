# 反馈闭环

## 建立正式 FND 的条件

- AI 或人工已经宣称任务完成，反馈推翻该状态。
- 问题揭示需求、设计、任务或 Gate 的遗漏。
- 问题需要永久回归测试。
- 问题可能在后续合同中重复。

## 终态

正常修复依次进入 `reported`、`reproduced`、`classified`、`planned`、`fixing`、`verified`、必要时 `human-retested`、`closed`。无法成立或暂不处理时使用 `rejected` 或 `deferred`，并保存原因和人工确认。

## 反向升级

逐项给出 `required`、`unchanged` 或 `not-needed` 结论。只有跨功能、可确定性检查且误报风险可接受的问题才建议升级为 repo-guard Gate。

## 测试环境与人工验收变体

当 `发现阶段` 为 `test-environment` 或 `human-acceptance` 时，发现正文必须增加实际的 `测试环境部署提交`。正常修复进入终态前，还必须增加人工复测项；两处部署提交都应绑定真正被复测的最终 `subjectCommit`，不能填写分支名或待定值：

```markdown
- 测试环境部署提交：`<REQUIRED_DEPLOYED_SUBJECT_COMMIT>`

- [ ] `<REQUIRED_FINDING_ID>-HUMAN-RETEST-001` 人工在测试环境复测
  - 执行者：`human`
  - 确认人：`pending`
  - 确认时间：`pending`
  - 测试环境部署提交：`pending`
```

人工确认真实复测结果后才勾选该项，并填写身份、带时区时间和部署提交。如果复测失败，保持未勾选、重新打开关联任务并继续同一 FND 闭环。

## 拒绝与延期变体

`rejected` 与 `deferred` 不表示问题被忽略。进入这两个终态前必须保存原始反馈登记、调查证据、逐项反向升级分析、关闭原因和人工确认。对于不是 `implementation-gap` 的反馈，可以不使用 `RED-TEST`、`FIX`、`GREEN-TEST`，但至少保留以下形状：

```markdown
- 当前状态：`rejected`
- 关闭原因：`<REQUIRED_FACT_BASED_CLOSING_REASON>`
- 确认人：`pending`
- 确认时间：`pending`

- [ ] `<REQUIRED_FINDING_ID>-REGISTER-001` 登记原始反馈
  - 执行者：`ai`
  - 证据：`pending`
- [ ] `<REQUIRED_FINDING_ID>-INVESTIGATE-001` 完成可复核调查
  - 执行者：`ai`
  - 证据：`pending`
- [ ] `<REQUIRED_FINDING_ID>-PROMOTION-001` 完成反向升级分析
  - 执行者：`ai`
  - 测试升级：`pending`
  - 合同升级：`pending`
  - 设计升级：`pending`
  - 任务模板升级：`pending`
  - 门禁升级：`pending`
  - 结论：`pending`
  - 确认人：`pending`
  - 确认时间：`pending`
```

调查和升级决定得到人工确认后才能填写真实值、勾选全部事项并进入终态。`deferred` 使用同一结构，但关闭原因还应明确重新评估条件。
