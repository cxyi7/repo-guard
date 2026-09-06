---
schemaVersion: 2
documentType: requirements
contractId: "<REQUIRED_CONTRACT_ID>"
revision: 1
confirmation:
  status: pending
  revision: 1
  confirmedAt: null
  confirmedBy: null
  comment: 待人工确认本地需求事实。
  sourceBundleDigest: pending
sources:
  - id: SRC-001
    name: "<REQUIRED_LOCAL_REQUIREMENT_SOURCE_NAME>"
    acquisition: download
    originalUrl: null
    files:
      - path: "requirements/rev-001/sources/<REQUIRED_CONFIRMED_AT_TIMESTAMP>__<REQUIRED_SOURCE_FILENAME>"
        mediaType: "<REQUIRED_MEDIA_TYPE>"
        digestAlgorithm: sha256-bytes-v1
        digest: pending
sourceBundleDigest: pending
facts:
  - id: REQ-001
    summary: "<REQUIRED_ATOMIC_REQUIREMENT_FACT>"
    sourceId: SRC-001
    locator: "<REQUIRED_HUMAN_READABLE_SOURCE_LOCATOR>"
blockingQuestions:
  - "<REQUIRED_RESOLVE_AND_REMOVE_THIS_BLOCKING_QUESTION_BEFORE_CONFIRMATION>"
---

# 需求事实

此文件故意保持未确认状态。只有本地来源文件已保存并受 Git 跟踪、字节指纹已计算、需求事实已由人工确认且所有阻塞问题已经解决后，才能清空 `blockingQuestions`。
