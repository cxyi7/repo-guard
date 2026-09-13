# Node 后端默认开关审查 7.1.4

本次仅调整 Node 新建配置。用户已明确不默认启用普通 Stylelint、图片与代码位置；这些开关维持关闭。代码位置是精确代码文本的位置约束，并非源码目录规范。

## 实现与边界

- 默认开启 build、unitTest、coverage、mutationTest、architecture、deadCode、pathNaming、functionDocs、fileHeader；typeCheck 仅 node-typescript 开启。
- 原有 ESLint、Prettier、源码安全、文件规模、测试归位与依赖策略保持开启。
- 新建预设在 createProjectDocument 写入，normalizeProjectDocument 不应用新增开关。用户已有关闭值、路径、阈值及原生工具配置不改写。
- 普通 Stylelint、图片、代码位置和前端专属检查继续关闭，Java 的 18 项专属检查也没有改变。
- 只开开关，不虚构测试入口、业务分层或具体框架规则。默认脚本、源码范围及工具配置由项目接入准备；未准备不能当作已通过。
- 没有新增依赖或安装 Skill。接入缺项登记在 Skill 待办文档。

## 检查

24 项针对性验证通过，包含 JS/TS 新建默认、Schema 与序列化、既有配置保护、Java 隔离，以及真实 ESLint、Prettier、tsc、构建、Vitest、dependency-cruiser 和 Knip 消费测试。

106 项文档与架构边界验证通过。npm run check 通过，包括 ESLint、409 个模块的架构检查和中文文案检查。npm 打包检查通过，未发布。

完整回归共 1,518 项，1,495 通过、20 跳过、3 失败；失败均为前端隔离测试仍断言 Node 的 Knip、路径命名和类型检查默认关闭。按本次需求更新预期，保留前端规则不继承与旧配置不变的断言后，相关 32 项回归全部通过、无跳过。补充断言确认 Node 类型检查不加载 vue-tsc 选项，路径命名不套用前端预设。没有修改生产规则来适配旧测试，不将修正前的完整结果表述为零失败。

真实工具测试逐项准备工具并隔离无关检查，不代表一个业务项目已经完成全部工具接入；默认配置的整体合法性由独立测试验证。
