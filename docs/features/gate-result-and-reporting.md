# GateResult 与报告

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

用统一结构回答“检查了什么、是否通过、为什么、怎么修”，便于人阅读，也便于 CI 与交付证据复核。

## 结果状态

| 状态 | 含义 | 统一退出码 |
|---|---|---|
| `passed` | 本轮实际检查通过 | 0 |
| `skipped` | 配置关闭或不适用，需阅读跳过原因 | 0 |
| `violation` | 发现规则违规，或交付必需证据、联合验证、验收条件尚未满足 | 2 |
| `configuration-error` | 配置或项目准备条件不满足 | 1 |
| `execution-error` | 工具运行、超时或内部执行失败 | 1 |
| `range-error` | Git 变更范围无法可靠建立 | 3 |

手动检查、Hook、CI、多应用与独立交付共用上述码表；Hook 不再把所有失败压成 `1`。退出码用来判断命令是否阻断及失败大类，具体的规则、应用、文件和修复方式仍查看报告。

该协议针对 repo-guard 自身命令及生成的 Hook、运维检查脚本。`git commit`、`git push`、npm 或 CI 平台属于外层工具，可以采用自身的返回码；不能保证从这些包装入口观察到相同数字。需要机器区分失败类型时，读取 repo-guard 的命令结果与结构化报告。

## 整体退出码怎样确定

先按本轮策略选择需要阻断的检查，再按 **执行错误 → 配置错误 → 范围错误 → 违规** 汇总。同类状态保留原始分项结果，不能取第一个失败或最大的数字码；调换应用配置顺序不会改变最终退出码。例如前端违规为 `2`、后端工具启动失败为 `1`，无论先检查哪一端，整体都返回 `1`。

- 所有需要阻断的检查通过，返回 `0`；配置关闭或不适用也可返回 `0`，但 `skipped` 不代表检查已通过。
- CI 的 `report` 模式保留问题与原始状态，不把该问题纳入阻断汇总；只报告的违规可以与整体 `0` 同时存在。
- `delivery status` 成功读取状态返回 `0`，即使交付尚未完成。要判断交付是否满足条件，使用 `delivery verify`；未满足条件时 `verify` 和 `accept` 均返回 `2`。
- 第三方进程的退出码是诊断事实，不能直接成为 repo-guard 的退出码。适配器根据工具协议分类；程序无法启动、超时或被信号终止归为执行错误 `1`。
- 独立交付中，普通命令正常执行后非零表示该检查未通过，返回 `2`；启动、超时等运行异常返回 `1`。引用工程 Gate 时保留其原始结果分类。签名证据仍使用 `passed / failed`，运行异常不会得到通过证据；排查时同时读取命令结果与诊断。

码表、映射、原始进程结果归类与汇总只在[公共退出码模块](../../src/core/result/exit-code.js)维护。各入口调用同一模块；[架构检查](../../test/architecture/exit-code-boundary.test.js)限制入口自行编码或直接写入进程退出码，新增功能遵循同一规则。

## 报告在哪里

```bash
npx repo-guard ci --profile full --report-json reports/repo-guard.json
```

先按[CI 接入](gitlab-ci.md)配置可信范围与环境。整体 CI 报告包含计划、步骤和单项结果，不是一个裸 GateResult。产物路径遵守报告写入边界；不要覆盖源码或受跟踪业务文件。

单项结果以 `gateId` 标识来源；`findings` 和统一 `issues` 描述问题，`artifacts` 指向产物，`metrics` 保存数值，`durationMs` 记录耗时，`diagnostics` 保存标明来源/输出流的原始工具诊断。问题包含位置、证据、预期、修复与复核指导，中文主结论与第三方原始诊断分开。

## 执行失败与原始诊断

Git 非零退出、无法启动或被信号终止时，主错误说明、退出事实及修复指导使用中文。第三方原文保存到 `diagnostics`，携带 `source / stream / level` 以及脱敏、截断标记；控制台明确标记“第三方原始诊断”。领域错误携带的诊断进入 GateResult 后继续保留，重复规范化结果不会重复添加；问题的 `evidence` 不混入第三方原文。

读取配置快照时，只有成功检查索引或提交树后才能确认文件不存在。Git 对象缺失、索引损坏和命令执行失败保留为执行错误，不能误报为需要补建配置，也不能因此跳过工程检查。真实删除已接入配置仍被阻断。排查时先检查对应 Git 诊断和仓库状态，保留暂存及未暂存修改。

流式工具执行与外部 npm 门禁共用进程树清理。超时、取消或外部门禁输出超限触发中止后，额外清理等待最多 2000ms；Windows 使用 `taskkill`，其他平台终止进程组。清理失败会尝试直接终止父进程、释放当前进程的管道和引用，并返回执行错误 `1`，不再无限等待后代关闭输出管道。此错误不证明后代已全部退出：按报告检查遗留进程和终止权限，解决原始失败原因后重新执行。

实时展示的单行缓冲最多 1 MiB，长时间不换行且超过上限时丢弃整行并提示，换行后恢复展示；跨数据块的私钥仍受脱敏保护。展示截断不改变门禁结果，外部门禁自身的总输出上限仍按原规则阻断。

## 多应用报告

显式 `projects` 工作区使用聚合报告版本 2。`selectedProjects` 明确列出本轮选择的应用；`targets` 保留公共仓库、各应用和最终交付证据的独立报告。每个目标包含 `projectId`、`projectRoot`、`scope`、`reportPath` 和 `exitCode`，不会把一个应用的结果当作另一个应用的结果。

| 输出 | 位置 |
|---|---|
| 聚合报告 | 仓库根目录 `ci.reportPath`，默认 `reports/repo-guard.json` |
| 公共规则 | 根目录 `reports/repo-guard-workspace/repository.json` |
| 应用检查 | 应用目录内 `reports/repo-guard-workspace/projects/<项目 id>.json` |
| 最终证据复核 | 根目录 `reports/repo-guard-workspace/evidence.json`，仅在 `release-ready` 执行 |

`gateResults` 按门禁 id 汇总本轮目标结果，同名门禁使用最严重状态，并保留各目标的结果指纹。`scopedGateResults` 保存 `projectId / projectRoot / gateResult`，明确是哪一个应用执行了检查；不能只按 Gate 名称替其他应用证明通过。定位具体文件时查看 `targets` 下的原始结果。每个单项 GateResult 继续使用 `schemaVersion: 2`。

任何按 CI 策略必须阻断的目标失败，聚合结果都会失败。CI 禁用或目标配置错误也会保留在聚合结果中并返回非零。`--project api` 的报告只包含 `api` 与公共仓库，不表示未选择应用已经通过。聚合路径不能与独立报告、外部门禁报告路径重复，也不能覆盖受跟踪文件或经符号链接写入；错误报告同样避让这些结果文件。

普通 `policy / full` 默认只选择本轮 Git 变更影响的应用；`release-ready` 默认复核全部应用。读取报告时先看 `selectedProjects`，再看具体结果，不能由整体退出码推断未执行范围也已满足要求。

## 独立交付证据

独立合同使用 `repo-guard.delivery.json` 固定合同版本和本方身份。参与方证据写在配置的 `evidenceDirectory` 下，默认是 `reports/delivery/participants/<参与方>.json`；载荷绑定合同指纹、参与方、仓库、代码提交和检查定义，并由受信执行者签名。它与普通 CI JSON 报告用途不同，不由人工抄写“通过”生成。

实际检查的 `passed` 才能满足必需项。联合命令还必须生成本轮报告，确认观察到的参与方提交与目标版本组合一致；负责人验收绑定完整证据指纹。换代码、改检查或更新合同后，应重新执行和汇总，旧联合结果与验收不能沿用。签名验证来源与传输完整性，不能自动证明远端部署真实情况或业务正确性。

操作及联合报告字段见[独立交付与跨仓库协作](delivery-contract.md#独立交付与跨仓库协作)；仓库内多文件合同包继续按原 Evidence Run 流程整理本轮结果，不能混用两套证据格式。

## 怎样复核

先确认本轮入口与文件/提交范围，再区分违规和环境问题。修复后重新执行相同入口，比较当前结果，不使用旧报告或截图代替。交付证据还需绑定真实提交、文件哈希和完整 GateResult，操作见[交付证据与两轮复核](delivery-contract.md#交付证据与两轮复核)。

## 维护依据

[结果结构](../../src/core/result/gate-result.js) · [统一退出码](../../src/core/result/exit-code.js) · [工作区报告聚合](../../src/orchestration/ci/workspace-runner.js) · [对应测试](../../test/ci/workspace-ci.test.js) · [出口边界测试](../../test/architecture/exit-code-boundary.test.js)

[Git 错误诊断](../../src/git/command-error.js) · [进程树清理](../../src/core/execution/process-tree.js) · [结果与呈现回归](../../test/core/gate-result.test.js) · [Git 执行回归](../../test/core/git-execution.test.js)
