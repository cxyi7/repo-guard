# 发布证据规则

## Evidence Run 必须绑定

- 合同 ID、修订和定义指纹。
- 需求修订、来源整批指纹和需求事实指纹。
- 资料计划指纹。
- 原始基线、最新目标提交、最终集成基线和被验收代码提交。
- 完整 GateResult、执行日志和结构化 `EVD-*`。

## 复核顺序

先提交最终功能代码并确定 `subjectCommit`，再整理证据元数据。证据复核至少分两轮：第一轮 release-ready 生成当前前序 GateResult，从未跟踪 CI 报告的 `steps[*].gateResult` 读取合同清单实际引用的结果，随后形成 Evidence Run 和技术证据指纹；人工验收必须绑定最终代码提交、当前定义指纹和该技术证据指纹。勾选 `HUMAN-ACCEPT-*` 后执行状态已经变化，所以必须再运行 delivery-evidence 更新最终 `executionDigest`。提交证据元数据后，最后一轮 release-ready 重新运行前序 GateResult 并与 Evidence Run 保存内容逐项比较。

第一轮和最终一轮不是重复记账：第一轮提供待验收的技术事实，最终一轮证明已提交的证据仍与当前执行一致。若最终一轮的 GateResult 发生变化，更新 Evidence Run 会改变技术证据指纹，原人工验收随即失效；必须解释变化、重新验收并再次完成最终复核。

## 目标分支漂移变体

只有 `targetCommit` 与原始 `baselineCommit` 相同时，`integrationAnalysis` 才能为 `null`。目标分支已经前进时，使用完整对象并由 Git 复算 `changedPaths`：

```yaml
integrationAnalysis:
  fromCommit: "<REQUIRED_BASELINE_COMMIT>"
  toCommit: "<REQUIRED_CURRENT_TARGET_COMMIT>"
  changedPaths:
    - "<REQUIRED_GIT_RECALCULATED_CHANGED_PATH>"
  impact: pending
  summary: "<REQUIRED_AI_IMPACT_ANALYSIS>"
  confirmation:
    status: pending
    confirmedAt: null
    confirmedBy: null
    targetCommit: "<REQUIRED_CURRENT_TARGET_COMMIT>"
    contractRevision: 1
    definitionDigest: pending
```

`impact` 只能在分析后填写 `none` 或 `contract-change`。人工确认必须绑定当前目标提交、当前合同修订和当前定义指纹；如果结论是 `contract-change`，先修订合同并重新完成规划确认，不能继续沿用旧 Evidence Run。

## 失效条件

目标分支继续前进、代码或测试在验收后变化、合同定义变化、证据文件变化、事项重新打开或出现未关闭 FND 时，旧证据失效。
