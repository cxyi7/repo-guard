# 配置迁移与规则启停

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

2.0.0 使用显式项目身份与分区配置。旧 v1 文件不能直接执行，通过迁移命令保留原有规则、阈值和开关，并转换为 v2。

## 操作方式

```bash
npx repo-guard migrate --project web --role frontend --stack node --preset vue-javascript
npx repo-guard doctor
npx repo-guard enable pathNaming
npx repo-guard disable pathNaming
```

`migrate` 要求明确项目身份，先验证，再将原文件逐字节备份为 `repo-guard.config.v1.backup.json`，转换配置并同步 AGENTS 与交付 Skills。已有备份不会被覆盖；当前只要旧运维 pipeline 与默认配置不同，就会在写入前报错并保留原配置，需按[运维发布](operations.md)人工拆分，尚不提供自动部署配置转换。Node 后端使用 `--role backend --stack node --preset node-javascript` 或 `node-typescript`；与身份冲突的 Vue 专用检查不能自动带入后端。

v2 中应用功能位于 `checks`，团队规则位于 `repository`，动画和通知位于 `reporting`，CI 质量策略位于 `ci`。部署使用独立文件 `repo-guard.ops.json`。`enable` / `disable` 接受[完整开关表](../usage-guide.md#启用或关闭能力)中的名字；开关名、配置路径和 Gate ID 是不同概念，启停命令不会偷偷迁移旧格式。

多应用开关使用 `repo-guard enable unitTest --project api`。应用检查只修改所选应用的配置；公共规则写入仓库根配置，修改前会验证所有应用仍然有效。

| 操作 | 联动结果 |
|---|---|
| 启用 `coverage` 或 `componentInteraction` | 同时启用 `unitTest` |
| 关闭 `unitTest` | 同时关闭组件交互和覆盖率检查 |
| 启用 `styleComplexity` 或 `styleGovernance` | 同时启用 Stylelint |
| 关闭 Stylelint | 同时关闭两项样式增强 |
| 启用 `unusedImageAssets` | 同时启用图片治理 |
| 关闭图片治理 | 同时关闭无效图片检查 |
| 启停 `deliveryContract` | 按托管指纹同步或移除对应 Skill；人工修改导致冲突时拒绝覆盖 |

## 失败处理与复核

直接修改 v2 配置后执行 `repo-guard doctor --fix` 同步规范，再检查差异与 Doctor。配置中的未知字段、无效枚举或跨字段冲突应按 Schema 修正。托管文件有人工改动时先比较差异、保留需要的内容，再解决冲突。

启用检查仍需安装对应项目工具。迁移不运行完整质量测试；用真实提交、专项命令或相应 CI 配置档确认规则生效。

## 维护依据

[实现入口](../../src/orchestration/setup/config-management.js) · [对应测试](../../test/setup/config-management.test.js)
