# 合同驱动交付格式

本文定义 `repository.delivery-contract` 与 `release.delivery-evidence` 当前支持的 `schemaVersion: 2` 多文件合同包。功能默认关闭；启用方式见根目录 README。

## 1. 文件关系

```text
docs/delivery/
├─ feature-registry.json
└─ contracts/
   ├─ DC-20260906-001.md
   └─ DC-20260906-001/
      ├─ spec.md
      ├─ design.md
      ├─ traceability.md
      ├─ obligations.md
      ├─ findings/
      │  └─ FND-20260906-001.md
      ├─ evidence/
      │  ├─ files/
      │  │  └─ EXEC-UNIT-001.txt
      │  └─ runs/
      │     └─ RUN-20260906-001.md
      └─ requirements/
         └─ rev-001/
            ├─ requirements.md
            └─ sources/
               └─ SRC-001__20260906T143022+0800__原始需求.pdf
```

功能登记表保存长期功能身份和归属，交付合同保存一次可独立验收、发布或回滚的交付。一个功能可以引用多份历史合同；当前分支只能匹配一份 `lifecycle: active` 的主合同。

交付合同主 Markdown 必须是 `contractsDirectory` 的直接子文件；同一合同的需求事实、追踪关系、执行清单、逐项发现、Spec、Design 和证据放在以合同 id 命名的子目录中。门禁只把直接子文件识别为合同，再从主合同 `materials` 加载完整合同包；子目录内的 Markdown 不会被误解析为另一份合同。

## 2. 树形功能登记表

每个节点必须完整提供固定字段。`children` 和 `deliveryContracts` 必须分开；没有内容时使用空数组。

```json
{
  "schemaVersion": 1,
  "features": [
    {
      "id": "community-profile",
      "name": "小区资料",
      "status": "active",
      "confirmedAt": "2026-09-06T10:00:00+08:00",
      "confirmedBy": "产品负责人",
      "requirementSource": "https://example.com/community-profile",
      "uiSource": null,
      "description": "维护小区基础信息。",
      "children": [
        {
          "id": "community-library",
          "name": "小区资料库",
          "status": "active",
          "confirmedAt": "2026-09-06T11:00:00+08:00",
          "confirmedBy": "产品负责人",
          "requirementSource": "https://example.com/community-library",
          "uiSource": "https://example.com/community-library-ui",
          "description": "管理归属于具体小区的文件资料。",
          "children": [],
          "deliveryContracts": [
            {
              "id": "DC-20260906-001",
              "path": "docs/delivery/contracts/DC-20260906-001.md"
            }
          ]
        }
      ],
      "deliveryContracts": []
    }
  ]
}
```

状态只接受 `proposed`、`active`、`retired`。`proposed` 的确认人和确认时间必须为 `null`；只有经过人工确认的 `active` 功能可以被活动合同引用。功能 id 与合同引用 id 在整棵树中必须唯一。

## 3. 主合同 Markdown Frontmatter

合同必须使用 YAML Frontmatter，`schemaVersion` 固定为 `2`。主合同只保存稳定身份、仓库边界、资料计划、人工确认和最终证据索引；增长型内容保存在组成文件中。下例省略了真实指纹内容：

```yaml
---
schemaVersion: 2
contractId: DC-20260906-001
contractRevision: 1
featureId: community-library
type: feature
lifecycle: active
summary: 首次交付小区资料库。
relations: {}
historicalFeedbackApplied: []
repository:
  workingBranch: feat/community-library
  targetBranch: main
  baselineCommit: "0123456789012345678901234567890123456789"
  changeBoundary:
    allowedPaths:
      - src/modules/community-library/**
      - test/community-library/**
      - docs/delivery/**
    forbiddenPaths:
      - src/payment/**
  worktree:
    policy: preferred
materials:
  requirements: requirements/rev-001/requirements.md
  traceability: traceability.md
  obligations: obligations.md
  findingsDirectory: findings
artifactPlan:
  generatedBy: ai
  generatedAt: "2026-09-06T14:40:00+08:00"
  items:
    spec:
      mode: file
      paths: [spec.md]
      reason: 包含多项可独立验收的业务行为。
    design:
      mode: file
      paths: [design.md]
      reason: 同时涉及接口、权限和状态管理。
    tasks:
      mode: inline
      paths: []
      reason: 任务数量较少，直接保存在合同中。
    examples:
      mode: reference
      paths: [src/shared/upload/file-upload-service.ts]
      reason: 复用现有上传和错误处理模式。
    visuals:
      mode: not-needed
      paths: []
      reason: 本次不改变界面布局和视觉状态。
  confirmation:
    status: confirmed
    confirmedAt: "2026-09-06T15:00:00+08:00"
    confirmedBy: 产品负责人
    comment: 确认资料计划。
confirmation:
  status: confirmed
  confirmedAt: "2026-09-06T15:00:00+08:00"
  confirmedBy: 产品负责人
  comment: 确认合同定义和边界。
  definitionDigest: "sha256:<64 位小写十六进制>"
---
```

`type` 只接受 `feature`、`enhancement`、`repair`、`refactor`、`maintenance`，与 Git commit type 无关。`relations` 可包含 `follows`、`repairs`、`dependsOn` 字符串数组。

资料 `mode` 只接受：

- `inline`：正文必须存在同名的 `## Spec`、`## Design`、`## Tasks`、`## Examples` 或 `## Visuals` 非空章节。
- `file`：`paths` 必须引用当前合同目录内至少一个受 Git 跟踪的文件。
- `reference`：`paths` 必须引用仓库内至少一个受 Git 跟踪的文件。
- `not-needed`：`paths` 必须为空，并提供具体理由。

Gate 按人工确认后的资料计划检查，不要求固定文件数量。改变需求、资料计划、正文定义、Git 边界或清单定义都会改变 `definitionDigest`，必须提升 `contractRevision` 并重新确认。

Gate 会从 Git 历史读取上一份合同定义。定义指纹变化时，`contractRevision` 必须在上一修订基础上连续加一，确认时间必须晚于上一修订；只同时改写定义、指纹和原确认字段不能通过。历史中已经确认的义务、正式 `FND-*` 和旧需求修订文件不得删除。`historicalFeedbackApplied` 必须是数组；同一 `featureId` 的历史关闭合同存在正式发现时，新合同必须说明这些发现已经转化到哪些当前需求、任务、测试或 Gate。

`repository.targetBranch` 必须能解析到本地分支或 `origin/<targetBranch>` 的真实提交。目标分支前进不会静默覆盖 `baselineCommit`；最终证据必须绑定最新目标提交，并保存 Git 可复算的漂移路径、AI 影响分析和人工确认。

## 4. 合同组成文件

组成文件全部使用 YAML Frontmatter、`schemaVersion: 2` 和相同的 `contractId`。`requirements`、`traceability`、`obligations` 必须由主合同 `materials` 显式引用；`findingsDirectory` 下每个直接子 Markdown 必须且只能保存一个 `FND-*`。组成文件必须受 Git 跟踪，缺失、越出合同目录、类型错误或绑定其他合同都会阻断。

当前需求修订固定保存在 `requirements/rev-NNN/requirements.md`：

```yaml
---
schemaVersion: 2
documentType: requirements
contractId: DC-20260906-001
revision: 1
confirmation:
  status: confirmed
  revision: 1
  confirmedAt: "2026-09-06T14:30:22+08:00"
  confirmedBy: 产品负责人
  comment: 确认本地文件为需求事实基线。
  sourceBundleDigest: "sha256:<64 位小写十六进制>"
sources:
  - id: SRC-001
    name: 小区资料原始需求
    acquisition: download
    originalUrl: https://example.com/requirement
    files:
      - path: docs/delivery/contracts/DC-20260906-001/requirements/rev-001/sources/SRC-001__20260906T143022+0800__原始需求.pdf
        mediaType: application/pdf
        digestAlgorithm: sha256-bytes-v1
        digest: "sha256:<64 位小写十六进制>"
sourceBundleDigest: "sha256:<64 位小写十六进制>"
facts:
  - id: REQ-001
    summary: 用户可以查看当前小区的资料列表。
    sourceId: SRC-001
    locator: 第 2 页“资料列表”
blockingQuestions: []
---
```

`traceability.md` 使用 `documentType: traceability`，在 `entries` 中保存每条需求事实到设计、任务、资料和验证的映射。`obligations.md` 使用 `documentType: obligations`，正文保存唯一的交付执行清单。需求或追踪内容改变属于定义变化；只改变执行勾选和证据引用属于执行状态变化。

## 5. 本地需求快照和指纹

第一版只接受 `download` 或 `screenshot` 形成的本地文件，不访问 `originalUrl`。同一批文件使用同一个确认时间，文件名时间格式为 `YYYYMMDDTHHmmss+HHmm`。

`screenshot` 来源必须记录 `capturedBy` 和 `coverage`，说明由谁执行真实截图以及覆盖范围；同一来源包含多个文件时，每个文件必须登记从 `1` 开始、唯一且连续的 `sequence`，带 `__page-NNN` 的截图文件名还必须与该序号一致。`requirements.confirmation.revision` 必须等于当前 `requirements.revision`。

单文件指纹是原始字节的 SHA-256，不进行换行、图片、压缩包或 Office 文档归一化。整批指纹的输入为按路径升序排列的下列文本，行之间使用 LF：

```text
仓库相对路径<TAB>不带 sha256: 前缀的文件指纹
```

新需求或需求变化必须新建 `requirements/rev-NNN`，不得覆盖旧修订。`facts` 的 id 以 `REQ-`、`INV-` 或 `AC-` 开头，并引用具体 `sourceId` 和可人工定位的 `locator`。存在阻塞问题时，`blockingQuestions` 不得清空，合同也不能确认。

## 6. 主合同正文与执行清单

主合同正文至少包含非空的 `交付目标`、`非目标` 和 `验收条件`。执行清单单独保存在 `obligations.md`，使用受约束的 GFM 格式：

```markdown
## 交付执行清单

- [x] `HUMAN-PLAN-001` 人工确认合同定义和资料计划
  - 执行者：`human`
  - 确认人：产品负责人
  - 确认时间：2026-09-06T15:00:00+08:00
  - 绑定定义指纹：`sha256:...`

- [ ] `TASK-001` 实现资料列表
  - 执行者：`ai`
  - 证据：`pending`

- [ ] `TEST-001` 列表和权限回归测试通过
  - 执行者：`gate`
  - 门禁：`release.test`
  - 证据：`pending`

- [ ] `HUMAN-ACCEPT-001` 人工最终验收通过
  - 执行者：`human`
  - 确认人：pending
  - 确认时间：pending
  - 绑定提交：`pending`
  - 绑定定义指纹：`sha256:...`
  - 技术证据指纹：`pending`
```

合同必须且只能有一个 `HUMAN-PLAN-*` 和一个 `HUMAN-ACCEPT-*`。清单 id 在整个合同包内唯一；`traceability.md` 中的 `tasks` 与 `verification` 必须引用真实清单 id。AI 和 Gate 项完成时记录证据，人工项由人工填写确认人、确认时间和绑定值。第一版依靠 Git 评审与受保护文件策略确保 AI 不冒充人工，不提供电子签名。

## 7. 交付发现

普通开发中间失败保存在运行日志。已经宣称完成、推翻完成状态、暴露合同遗漏、需要回归测试或可能重复发生的问题，必须升级为正式 `FND-*`。每个发现独立保存为 `findings/FND-*.md`，并使用以下 Frontmatter：

```markdown
---
schemaVersion: 2
documentType: finding
contractId: DC-20260906-001
findingId: FND-20260906-001
---

## 交付发现

### `FND-20260906-001` 跨小区访问校验缺失

- 发现者：`ai`
- 发现阶段：`self-test`
- 发现时间：2026-09-06T18:30:00+08:00
- 问题版本：`<完整 40 位提交哈希>`
- 类型：`implementation-gap`
- 严重程度：`high`
- 重复特征：`community-library.cross-community-access`
- 关联任务：`TASK-002`
- 当前状态：`closed`

#### 处理清单

- [x] `FND-REGISTER-001` 已登记发现、问题版本和重复特征
  - 执行者：`ai`
  - 证据：`EVD-REGISTER-001`
- [x] `FND-REPRODUCE-001` 已稳定复现问题
  - 执行者：`ai`
  - 证据：`EVD-REPRODUCE-001`
- [x] `FND-CLASSIFY-001` 已完成原因分类
  - 执行者：`ai`
  - 结论：`implementation-gap`
- [x] `FND-RED-TEST-001` 新测试在错误代码上失败
  - 执行者：`ai`
  - 测试：`TEST-COMMUNITY-ISOLATION-001`
  - 绑定提交：`<问题版本提交>`
  - 证据：`EVD-RED-001`
- [x] `FND-FIX-001` 已完成代码修复
  - 执行者：`ai`
  - 证据：`EVD-FIX-001`
- [x] `FND-GREEN-TEST-001` 同一测试在修复代码上通过
  - 执行者：`ai`
  - 测试：`TEST-COMMUNITY-ISOLATION-001`
  - 绑定提交：`<最终代码 subjectCommit>`
  - 证据：`EVD-GREEN-001`
- [x] `FND-PROMOTION-001` 已完成反向升级分析
  - 执行者：`ai`
  - 测试升级：`required`
  - 合同升级：`unchanged`
  - 设计升级：`unchanged`
  - 任务模板升级：`unchanged`
  - 门禁升级：`not-needed`
  - 结论：保留永久回归测试，合同和设计不变，暂不升级全局 Gate
  - 确认人：产品负责人
  - 确认时间：2026-09-06T19:00:00+08:00
- [x] `FND-VERIFY-001` 已完成最终组合验证
  - 执行者：`ai`
  - 证据：`EVD-VERIFY-001`
```

发现者接受 `ai`、`human`、`gate`、`ci`、`production`；阶段接受 `development`、`self-test`、`ci`、`test-environment`、`human-acceptance`、`production`。状态接受：

```text
reported → reproduced → classified → planned → fixing → verified → human-retested → closed
reported → investigating → rejected / deferred
```

每个正式发现都必须关联当前合同中的真实任务；未进入 `closed`、`rejected` 或 `deferred` 的发现关联到已完成任务时，任务必须重新改为 `[ ]`。`rejected` 和 `deferred` 必须保存原因、确认人和确认时间，也必须登记原始反馈并完成人工确认的反向升级决定。测试环境或人工验收阶段的发现必须记录实际部署提交；正常关闭前必须具有绑定最终 `subjectCommit` 的 `HUMAN-RETEST-*` 人工复测项。

`implementation-gap` 必须具有同一测试绑定错误提交和最终代码提交的红—绿证明，红、绿两次运行分别引用结构化执行日志，退出码必须分别为非零和零。每个正式发现都必须逐项记录测试、合同、设计、任务模板和 Gate 的升级决定、结论以及人工确认；不是每个问题都必须升级为全局 Gate。

## 8. 发布证据

代码、测试和人工验收完成后，在主合同 Frontmatter 增加：

```yaml
deliveryEvidence:
  integrationBaseCommit: "<最终集成基线完整哈希>"
  subjectCommit: "<被验收代码完整哈希>"
  definitionDigest: "sha256:<当前合同定义指纹>"
  sourceBundleDigest: "sha256:<当前需求整批指纹>"
  evidenceRunPath: docs/delivery/contracts/DC-20260906-001/evidence/runs/RUN-20260906-001.md
  evidenceRunDigest: "sha256:<证据批次 Markdown 原始字节指纹>"
  technicalEvidenceDigest: "sha256:<当前技术证据指纹>"
  executionDigest: "sha256:<当前清单、发现和确认状态指纹>"
```

证据引用不能填写任意说明文字。清单、回归覆盖和 `FND-*` 中的 `EVD-*` 必须引用一个受 Git 跟踪的 Evidence Run。Evidence Run 同样使用 Markdown + YAML Frontmatter，既能由人审阅，也能由 repo-guard 确定性解析：

```yaml
---
schemaVersion: 2
runId: RUN-20260906-001
generatedAt: "2026-09-06T17:30:00+08:00"
contractId: DC-20260906-001
contractRevision: 2
definitionDigest: "sha256:<当前定义指纹>"
baselineCommit: "<合同原始基线>"
requirementsRevision: 1
sourceBundleDigest: "sha256:<需求来源整批指纹>"
requirementFactsDigest: "sha256:<需求事实指纹>"
artifactPlanDigest: "sha256:<含确认记录的资料计划指纹>"
targetBranch: main
targetCommit: "<生成批次时目标分支的提交>"
integrationBaseCommit: "<必须与 targetCommit 相同>"
subjectCommit: "<最终代码提交>"
integrationAnalysis: null
gateResults:
  - gateId: release.test
    resultDigest: "sha256:<下方完整 GateResult 内容指纹>"
    result:
      gateId: release.test
      status: passed
      summary: 测试通过
      findings: []
      artifacts: []
      metrics: {}
      error: null
      diagnostics: []
executionLog:
  - id: EXEC-UNIT-001
    occurredAt: "2026-09-06T17:10:00+08:00"
    commandId: test-unit
    subjectCommit: "<执行时提交>"
    exitCode: 0
    reportPath: docs/delivery/contracts/DC-20260906-001/evidence/files/EXEC-UNIT-001.txt
    resultDigest: "sha256:<报告文件原始字节指纹>"
evidence:
  - id: EVD-TASK-001
    type: commit
    description: TASK-001 对应的代码提交和实际路径。
    commit: "<代码提交>"
    paths: [src/modules/community-library/index.js]
  - id: EVD-TEST-001
    type: execution
    description: 单元测试执行记录。
    executionId: EXEC-UNIT-001
  - id: EVD-GATE-001
    type: gate-result
    description: 本轮 release.test 的完整结果。
    gateId: release.test
    resultDigest: "sha256:<GateResult 内容指纹>"
---

# 交付证据批次 RUN-20260906-001
```

Evidence 支持四种确定性类型：

- `file`：路径必须位于当前合同的 `evidence/` 目录、受 Git 跟踪且字节指纹一致。
- `commit`：提交必须存在、属于 `subjectCommit` 历史，声明路径必须确实由该提交修改。
- `execution`：引用执行日志；日志报告文件受 Git 跟踪并重新计算指纹。
- `gate-result`：引用 Evidence Run 中保存的完整 GateResult 及内容指纹；`release-ready` 会把它与本轮前序 GateResult 重新计算后比较。

当 `targetCommit` 与合同 `baselineCommit` 不同时，`integrationAnalysis` 不能为 `null`，必须包含 `fromCommit`、`toCommit`、完整 `changedPaths`、影响结论、说明和绑定当前目标提交/合同修订/定义指纹的人工确认。Gate 会使用 Git 重新计算漂移路径，并要求 `integrationBaseCommit` 等于当前目标分支提交且是 `subjectCommit` 的祖先。

`subjectCommit` 应先指向功能代码提交。随后追加的证据元数据提交只能修改主合同、`obligations.md`、当前发现、Evidence Run 及该批次显式引用并校验指纹的执行报告或文件证据；如果验收后继续修改代码、测试、需求文件、设计或其他未登记文件，证据自动失效并需要重新验证。release-ready 还要求已跟踪工作区干净。

推荐填写和复核顺序：

1. 暂存本地需求文件、登记表和初始合同，运行 `repo-guard delivery-contract`，按报告中的实际 SHA-256 修正来源指纹和整批指纹。
2. 使用报告给出的当前 `definitionDigest` 更新合同与 `HUMAN-PLAN-*`，由人工审阅并确认。
3. 开发、测试并在 `obligations.md` 记录 AI/Gate 证据；正式问题分别使用独立 `findings/FND-*.md` 闭环。
4. 提交最终功能代码，把该提交写入 `subjectCommit`，完成测试环境部署和技术验证，但此时不要提前勾选人工最终验收。
5. 运行第一轮 `repo-guard ci --profile release-ready --report-json reports/release-ready-evidence.json`。最后的证据 Gate 可以因为证据尚未完成而失败；从未跟踪报告的 `steps[*].gateResult` 读取本轮前序 Gate 的完整结果，把合同实际引用的 GateResult、执行日志和结构化 `EVD-*` 写入 Evidence Run。
6. 运行 `repo-guard delivery-evidence`，按报告更新 Evidence Run 文件指纹和 `technicalEvidenceDigest`。人工复核最终代码提交、当前定义指纹、当前技术证据指纹和测试环境结果后，填写并勾选 `HUMAN-ACCEPT-*`。
7. 人工项变化后再次运行 `repo-guard delivery-evidence`，使用重新计算的最终值更新 `executionDigest`；再提交只包含主合同、`obligations.md`、发现文件、Evidence Run 及其显式引用报告的证据元数据提交。
8. 运行最终一轮 `repo-guard ci --profile release-ready`。项目外部门禁先执行，最后的 `release.delivery-evidence` 会把本轮 GateResult 与 Evidence Run 逐项比较。若结果、目标分支或证据发生变化，回到受影响步骤，更新证据并重新人工验收。

证据批次因此是迭代形成的，至少包含“生成待验收技术事实”和“验收后最终复核”两轮。`technicalEvidenceDigest` 绑定 GateResult、执行报告和非人工事项；`executionDigest` 还绑定全部复选状态、人工确认和发现处理状态。勾选 `HUMAN-ACCEPT-*` 后沿用旧 `executionDigest` 必然失败，这是为了防止人工验收在摘要之外变化。

状态由检查结果推导：

```text
specified → boundary-valid → acceptance-ready → accepted → release-ready
```

repo-guard 不根据手写 `status` 判断结果，也不会声明 `released`，因为发布和部署仍属于项目或受控外部系统。

## 9. 并行分支与冲突

每个并行交付使用独立分支，推荐使用独立 Worktree。`worktree.policy` 为 `any`、`preferred` 或 `required`；本地 `preferred` 在主工作树产生警告，`required` 直接阻断。CI checkout 不要求复现本地 Worktree 形态。

`allowedPaths` 是授权边界，不是文件所有权。不同分支的合同可以允许同一文件。AI 可先用 `plannedChanges.paths` 记录预计修改范围；当前实际业务变更命中另一份可见合同的 `allowedPaths` 时，开发阶段会提示重叠，`release-ready` 则要求存在人工确认的协调与回归记录：

```yaml
plannedChanges:
  paths:
    - src/router/index.ts
    - src/modules/community-library/**
coordination:
  overlaps:
    - withContractId: DC-20260906-002
      paths: [src/router/index.ts]
      risk: symbol-overlap
      strategy: integrate-after
      status: confirmed
      reason: 两份合同均修改路由注册表，当前合同在前置合同落地后集成。
      confirmedAt: "2026-09-06T16:20:00+08:00"
      confirmedBy: 产品负责人
  dependencies:
    - contractId: DC-20260906-002
      relation: integrate-after
      requiredLandedCommit: "<前置合同在目标分支上的完整落地提交>"
regressionCoverage:
  affectedContracts:
    - contractId: DC-20260906-002
      reason: 路由注册表存在实际重叠。
      verification:
        - test: 前置功能路由回归测试
          result: passed
          evidence: EVD-ROUTER-REGRESSION-001
```

`risk` 接受 `file-overlap`、`line-overlap`、`symbol-overlap`、`behavior-overlap`；`strategy` 接受 `coexist`、`integrate-after`、`extract-foundation`、`consolidate`、`cancel`。`pending` 或 `conflicted` 不能进入最终交付；`confirmed` 或 `resolved` 必须记录人工身份与时间。

`integrate-after` 和 `extract-foundation` 必须登记 `requiredLandedCommit`。发布时该提交必须存在、属于当前 HEAD 的祖先，并已包含在 `integrationBaseCommit` 中。实际重叠的每份合同都必须有全部为 `passed` 且带证据的 `regressionCoverage`；`consolidate` 或 `cancel` 表示当前合同不能继续独立发布。

## 10. 确定性与安全边界

- 合同、登记表、需求文件和资料文件必须受 Git 跟踪；pre-commit 读取最终 Git index，不读取不同的未暂存副本。
- 合同不允许声明 shell 命令，只能引用官方 Gate 或已注册的 `project.*` 外部门禁。
- 合同路径边界与仓库保护文件 Gate 分开；即使合同允许，仍必须通过保护文件策略。
- `forbiddenPaths` 优先于 `allowedPaths`。删除检查原路径；重命名检查原路径与新路径；复制要求目标路径被允许，并检查来源和目标均未被禁止。
- CI detached HEAD 使用 `REPO_GUARD_SOURCE_BRANCH` 或 `REPO_GUARD_CONTRACT_ID` 选择合同，不能根据修改文件猜测合同身份。
- 任何越界修正、合同扩展、功能归属、资料省略或人工验收都必须由人确认，Gate 不自动扩大权限。
