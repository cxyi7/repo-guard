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

## 怎样复核

先确认本轮入口与文件/提交范围，再区分违规和环境问题。修复后重新执行相同入口，比较当前结果，不使用旧报告或截图代替。交付证据还需绑定真实提交、文件哈希和完整 GateResult，操作见[交付证据与两轮复核](delivery-contract.md#交付证据与两轮复核)。

## 维护依据

[实现入口](../../src/core/result/gate-result.js) · [对应测试](../../test/gate-result.test.js)
