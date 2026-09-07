# 配置迁移与规则启停

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

升级 repo-guard 或调整团队规则后，补齐配置结构，并让托管规范与当前配置一致。

## 操作方式

```bash
npx repo-guard migrate
npx repo-guard doctor
npx repo-guard enable pathNaming
npx repo-guard disable pathNaming
```

`migrate` 使用当前配置契约补齐缺失结构，保留已有有效选项，并同步 AGENTS 与交付 Skills。`enable` / `disable` 接受[完整开关表](../usage-guide.md#启用或关闭能力)中的名字；开关名、配置路径和 Gate ID 是不同概念。

| 操作 | 联动结果 |
|---|---|
| 启用 `coverage` 或 `componentInteraction` | 同时启用 `unitTest` |
| 关闭 `unitTest` | 关闭组件交互；保留覆盖率配置，父级关闭时不执行 |
| 启用 `styleComplexity` 或 `styleGovernance` | 同时启用 Stylelint |
| 关闭 Stylelint | 同时关闭两项样式增强 |
| 启用 `unusedImageAssets` | 同时启用图片治理 |
| 关闭图片治理 | 同时关闭无效图片检查 |
| 启停 `deliveryContract` | 按托管指纹同步或移除对应 Skill；人工修改导致冲突时拒绝覆盖 |

## 失败处理与复核

直接修改 `repo-guard.config.json` 后运行迁移，再检查差异与 Doctor。配置中的未知字段、无效枚举或跨字段冲突应按 Schema 修正，迁移不是任意旧格式的自动转换器。托管文件有人工改动时先比较差异、保留需要的内容，再解决冲突。

启用检查仍需安装对应项目工具。迁移不运行完整质量测试；用真实提交、专项命令或相应 CI 配置档确认规则生效。

## 维护依据

[实现入口](../../src/orchestration/setup/config-management.js) · [对应测试](../../test/config-management.test.js)
