# 动态代码检查

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

检查可识别的动态求值与 Function 构造写法，减少将字符串当成代码执行的入口。

## 执行入口

```bash
npx repo-guard dynamic-code
```

本能力没有 `enable/disable` 功能开关。适用的 pre-commit 固定执行，CI `policy`、`full` 和 `release-ready` 包含对应策略步骤，CI 的 `inherit/off/report/enforce` 单独决定执行方式。手动命令检查项目文件，提交入口检查对应暂存源码，具体结果应结合报告中的范围理解。

## 判断与修复

稳定规则 ID：`security/no-eval`、`security/no-function-constructor`。

将动态求值改为明确的对象映射、普通函数或数据解析。字符串是数据时不要交给 `eval`；动态函数生成也不能仅换一个别名来绕过规则。当前能力按 AST 识别支持的语法，不等于运行时沙箱或完整安全审计。

无法立即消除且规则支持例外时，按[结构化例外](structured-exceptions.md)登记精确位置、责任人、审核依据和有效期。通过表示本次范围内没有未获准的问题；不适用的文件不会因此获得业务或运行时安全保证。

修复后重新暂存并使用相同入口复核。实际界面仍需交互测试和人工验收。

## 维护依据

[实现入口](../../src/gates/security/dynamic-code-gate.js) · [对应测试](../../test/gates/security/dynamic-code.test.js)
