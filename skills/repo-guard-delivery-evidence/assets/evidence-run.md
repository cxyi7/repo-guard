---
schemaVersion: 2
runId: "<REQUIRED_RUN_ID>"
generatedAt: pending
contractId: "<REQUIRED_CONTRACT_ID>"
contractRevision: 1
definitionDigest: pending
baselineCommit: pending
requirementsRevision: 1
sourceBundleDigest: pending
requirementFactsDigest: pending
artifactPlanDigest: pending
targetBranch: "<REQUIRED_TARGET_BRANCH>"
targetCommit: pending
integrationBaseCommit: pending
subjectCommit: pending
integrationAnalysis: null
gateResults:
  - gateId: "<REQUIRED_GATE_ID>"
    resultDigest: pending
    result:
      gateId: "<REQUIRED_GATE_ID>"
      status: pending
      summary: "<REQUIRED_EXACT_GATE_RESULT_SUMMARY>"
      findings: []
      artifacts: []
      metrics: {}
      error: null
      diagnostics: []
executionLog:
  - id: EXEC-001
    occurredAt: pending
    commandId: "<REQUIRED_REGISTERED_COMMAND_ID>"
    subjectCommit: pending
    exitCode: pending
    reportPath: "docs/delivery/contracts/<REQUIRED_CONTRACT_ID>/evidence/files/EXEC-001.txt"
    resultDigest: pending
evidence:
  - id: EVD-COMMIT-001
    type: commit
    description: 被验收代码提交及其实际修改路径。
    commit: pending
    paths:
      - "<REQUIRED_PATH_CHANGED_BY_COMMIT>"
  - id: EVD-EXECUTION-001
    type: execution
    description: 可重新核验的执行报告。
    executionId: EXEC-001
  - id: EVD-GATE-001
    type: gate-result
    description: 本轮清单引用的完整 GateResult。
    gateId: "<REQUIRED_GATE_ID>"
    resultDigest: pending
---

# 交付证据批次

此资产只提供完整字段形状。必须使用当前仓库的真实提交、报告、GateResult 和 repo-guard 计算的指纹替换全部占位值。
