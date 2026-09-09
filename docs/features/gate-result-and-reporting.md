# GateResult 与报告

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

用统一结构回答“检查了什么、是否通过、为什么、怎么修”，便于人阅读，也便于 CI 与交付证据复核。

## 结果状态

| 状态 | 含义 | 单项通用退出码 |
|---|---|---|
| `passed` | 本轮实际检查通过 | 0 |
| `skipped` | 配置关闭或不适用，需阅读跳过原因 | 0 |
| `violation` | 已执行并发现规则违规 | 2 |
| `configuration-error` | 配置或项目准备条件不满足 | 1 |
| `execution-error` | 工具运行、超时或内部执行失败 | 1 |
| `range-error` | Git 变更范围无法可靠建立 | 3 |

上述是单项映射；pre-commit 会将阻断统一表现为退出码 1，CI 还结合各步骤策略决定整体结果。跳过不代表规则已经验证通过。

## 报告在哪里

```bash
npx repo-guard ci --profile full --report-json reports/repo-guard.json
```

先按[CI 接入](gitlab-ci.md)配置可信范围与环境。整体 CI 报告包含计划、步骤和单项结果，不是一个裸 GateResult。产物路径遵守报告写入边界；不要覆盖源码或受跟踪业务文件。

单项结果以 `gateId` 标识来源；`findings` 和统一 `issues` 描述问题，`artifacts` 指向产物，`metrics` 保存数值，`durationMs` 记录耗时，`diagnostics` 保存标明来源/输出流的原始工具诊断。问题包含位置、证据、预期、修复与复核指导，中文主结论与第三方原始诊断分开。

## 多应用报告

显式 `projects` 工作区使用聚合报告版本 2。`selectedProjects` 明确列出本轮选择的应用；`targets` 保留公共仓库、各应用和最终交付证据的独立报告。每个目标包含 `projectId`、`projectRoot`、`scope`、`reportPath` 和 `exitCode`，不会把一个应用的结果当作另一个应用的结果。

| 输出 | 位置 |
|---|---|
| 聚合报告 | 仓库根目录 `ci.reportPath`，默认 `reports/repo-guard.json` |
| 公共规则 | 根目录 `reports/repo-guard-workspace/repository.json` |
| 应用检查 | 应用目录内 `reports/repo-guard-workspace/projects/<项目 id>.json` |
| 最终证据复核 | 根目录 `reports/repo-guard-workspace/evidence.json`，仅在 `release-ready` 执行 |

`gateResults` 按门禁 id 汇总本轮目标结果，同名门禁使用最严重状态，并保留各目标的结果指纹。它为交付证据提供统一依据；定位具体文件时仍查看 `targets` 下的原始门禁结果。每个单项 GateResult 继续使用 `schemaVersion: 2`，无需改成应用私有协议。

任何按 CI 策略必须阻断的目标失败，聚合结果都会失败。CI 禁用或目标配置错误也会保留在聚合结果中并返回非零。`--project api` 的报告只包含 `api` 与公共仓库，不表示未选择应用已经通过。聚合路径不能与独立报告、外部门禁报告路径重复，也不能覆盖受跟踪文件或经符号链接写入；错误报告同样避让这些结果文件。

## 怎样复核

先确认本轮入口与文件/提交范围，再区分违规和环境问题。修复后重新执行相同入口，比较当前结果，不使用旧报告或截图代替。交付证据还需绑定真实提交、文件哈希和完整 GateResult，操作见[交付证据与两轮复核](delivery-contract.md#交付证据与两轮复核)。

## 维护依据

[实现入口](../../src/core/result/gate-result.js) · [工作区报告聚合](../../src/orchestration/ci/workspace-runner.js) · [对应测试](../../test/ci/workspace-ci.test.js)
