# AGENTS 托管规范

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

repo-guard 将项目配置和固定硬门禁投影为 7 个职责区块：仓库与变更治理、暂存代码质量、源码安全与资源生命周期、目录与文件结构、依赖与仓库健康度、测试质量、构建/交付与外部门禁。每个可配置功能至少对应一条规范；同一主题的能力会合并到同一区块，避免按功能生成大量零散章节。

当应用清单的 `root` 为 `.` 时，一份根 `AGENTS.md` 同时承载仓库公共提交信息、交付合同、文件归位规范以及该应用的工程规则。初始化、启停与 Doctor 使用相同的完整规范上下文；合成只用于规范生成和验证，不写入或传播到应用的检查配置。分目录应用仍各自维护工程规范，公共规范保留在仓库根目录。

- `init`、`enable`、`disable`、`doctor --fix` 和非预览的 `install-ci` 会同步托管区块。
- 同步前只接受当前七个区块的标准 marker，全部有效后才一次写入；marker 缺失、重复、倒置或嵌套时拒绝修改文件。
- 旧版、未知或新旧混合 marker 直接报错并保留原文件，不转换旧区块，也不追加新旧并存的规范。应先人工核对旧约定，再按当前分组重新接入。
- 公共写入口在修改配置、规范或 Hook 前，先只读校验相关目录的 marker 和仓库 Skill 清单；不会先改变功能开关、再因旧规范或旧清单失败。当前 marker 下的待同步正文仍可正常更新。
- 当前 marker 外的人工内容和先后顺序保持不变；已禁用功能的陈旧说明会从当前托管区块中删除。
- webhook、通知凭据和 `repository.codePlacement.content` 等敏感值不会写入托管规范。
- Git Hook 不写 `AGENTS.md`。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步，再运行 `npx repo-guard doctor` 复核。CI 的 `repository.agent-policy` 只读门禁在默认策略下阻断未同步内容。
- 托管规范没有独立的 `enabled` 开关，不能在保留功能门禁的同时关闭对应 AI 约束。

## 使用与复核

```bash
npx repo-guard doctor --fix
npx repo-guard doctor
```

人工约定写在托管 marker 之外。需要改变自动规范时修改源配置，再同步生成内容，避免只改 `AGENTS.md` 导致规则和文档冲突。

CI 的 `repository.agent-policy` 比较配置应生成的内容与现有文件；缺失、过期或 marker 不合法都会影响复核。AGENTS 提供 AI 可读约定，实际阻断仍由对应 Gate 完成，不能把文本存在当作业务已通过检查。

多应用仓库分别维护根目录的公共规范与各应用目录的工程规范。CI 对公共文件检查一次，并对所选应用逐个只读检查；前端和 Node 后端使用各自的角色与检查配置。`--project web` 仍检查公共规范，但不会检查或替 api 的规范给出通过结论。公共规范和应用规范分别遵循对应的 `ci.gatePolicy`；应用模式从公共默认模式开始，由应用显式配置。

根规范明确禁止把前端规则强加给后端，不要求在公共入口登记应用的依赖或例外。各级规范同时说明独立交付入口：启用 `repo-guard.delivery.json` 后，各方遵循共同合同、真实检查和当前版本验收；AI 负责开发与验证，人工保管签名私钥并确认合同和最终验收。

### 仓库级文件归位规范

`repositoryFilePlacement` 的配置只保存于 Git 根 `repo-guard.config.json` 的 `repository.filePlacement`，启用前必须准备非空 `rules`。开启后，根 `AGENTS.md` 的目录与文件结构区块说明全仓规则及检查入口，要求 AI 在移动文件时同步修改引用；仓库 Gate `repository.global-file-placement` 负责实际检查。配置示例见[仓库级文件归位](repository-file-placement.md)。

`enable repositoryFilePlacement` 和 `disable repositoryFilePlacement` 同步根托管规范，关闭时保留规则配置。手动编辑根规则后运行 `doctor --fix`；不要直接修改生成的规范来改变检查范围。子应用不会继承 `repository.filePlacement` 检查配置，也不能用应用归位开关或应用例外豁免公共规则；根规范适用于应用目录内外，应用规范继续描述自己的工程要求。

清单中的唯一应用如果声明 `root: "."`，仓库与应用共用一个根 `AGENTS.md`：渲染时合成仓库公共要求和该应用工程要求，包括已启用的仓库归位规则，只生成并核验一次。不会用应用默认关闭的公共字段覆盖根规则，也不同时要求两份互相冲突的文本。合成仅用于同一文件的托管规范，不把根规则写入子配置或改变应用检查的隔离边界。

## 维护依据

[实现入口](../../src/policies/agent-policies.js) · [对应测试](../../test/policies/agent-policy.test.js) · [多应用 CI 回归](../../test/ci/workspace-ci.test.js)

[启停与同步](configuration-management.md) · [根与应用配置边界](../../src/config/workspace-scopes.js)
