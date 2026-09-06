---
schemaVersion: 2
contractId: "<REQUIRED_CONTRACT_ID>"
contractRevision: 1
featureId: "<REQUIRED_CONFIRMED_FEATURE_ID>"
type: pending
lifecycle: active
summary: "<REQUIRED_INDEPENDENT_DELIVERY_SUMMARY>"
relations: {}
historicalFeedbackApplied: []
repository:
  workingBranch: "<REQUIRED_WORKING_BRANCH>"
  targetBranch: "<REQUIRED_TARGET_BRANCH>"
  baselineCommit: pending
  changeBoundary:
    allowedPaths:
      - "<REQUIRED_ALLOWED_PATH>"
    forbiddenPaths: []
  worktree:
    policy: preferred
materials:
  requirements: requirements/rev-001/requirements.md
  traceability: traceability.md
  obligations: obligations.md
  findingsDirectory: findings
artifactPlan:
  generatedBy: ai
  generatedAt: pending
  items:
    spec: { mode: pending, paths: [], reason: "<REQUIRED_SPEC_PLAN_REASON>" }
    design: { mode: pending, paths: [], reason: "<REQUIRED_DESIGN_PLAN_REASON>" }
    tasks: { mode: pending, paths: [], reason: "<REQUIRED_TASKS_PLAN_REASON>" }
    examples: { mode: pending, paths: [], reason: "<REQUIRED_EXAMPLES_PLAN_REASON>" }
    visuals: { mode: pending, paths: [], reason: "<REQUIRED_VISUALS_PLAN_REASON>" }
  confirmation:
    status: pending
    confirmedAt: null
    confirmedBy: null
    comment: 待人工确认资料计划。
confirmation:
  status: pending
  confirmedAt: null
  confirmedBy: null
  comment: 待人工确认合同定义。
  definitionDigest: pending
---

# 交付合同

## 交付目标

`<REQUIRED_ACCEPTABLE_DELIVERY_GOAL>`

## 非目标

`<REQUIRED_EXPLICIT_NON_GOALS>`

## 验收条件

`<REQUIRED_BUSINESS_ACCEPTANCE_CRITERIA>`
