# AGENTS 托管规范

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

repo-guard 将项目配置和固定硬门禁投影为 7 个职责区块：仓库与变更治理、暂存代码质量、源码安全与资源生命周期、目录与文件结构、依赖与仓库健康度、测试质量、构建/交付与外部门禁。每个可配置功能至少对应一条规范；同一主题的能力会合并到同一区块，避免按功能生成大量零散章节。

- `init`、`enable`、`disable`、`migrate`、`doctor --fix` 和非预览的 `install-ci` 会同步托管区块。
- 同步前会先校验全部当前 marker 和已知旧 marker，全部有效后才一次写入；marker 缺失、重复、倒置或嵌套时拒绝修改文件。
- marker 外的人工内容和先后顺序保持不变；已禁用功能的陈旧说明会被删除，旧的四类策略 marker 会迁移为当前分组。
- webhook、通知凭据和 `codePlacement.content` 等敏感值不会写入托管规范。
- Git Hook 不写 `AGENTS.md`。直接编辑配置后应运行 `npx repo-guard migrate` 或 `npx repo-guard doctor --fix`；CI 的 `repository.agent-policy` 只读门禁会阻断未同步内容。
- 托管规范没有独立的 `enabled` 开关，不能在保留功能门禁的同时关闭对应 AI 约束。

## 使用与复核

```bash
npx repo-guard migrate
npx repo-guard doctor
```

人工约定写在托管 marker 之外。需要改变自动规范时修改源配置，再同步生成内容，避免只改 `AGENTS.md` 导致规则和文档冲突。

CI 的 `repository.agent-policy` 比较配置应生成的内容与现有文件；缺失、过期或 marker 不合法都会影响复核。AGENTS 提供 AI 可读约定，实际阻断仍由对应 Gate 完成，不能把文本存在当作业务已通过检查。

## 维护依据

[实现入口](../../src/policies/agent-policies.js) · [对应测试](../../test/agent-policy.test.js)
