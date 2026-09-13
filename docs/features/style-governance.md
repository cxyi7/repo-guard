# Stylelint 样式隔离与全局目录

[统一配置](stylelint.md) · [功能索引](README.md)

`checks.stylelint.governance` 仅保留 `enabled` 与 `allowedGlobalStylePatterns`。新前端预设启用，全局目录默认根 `styles/**`；用户可改为真实目录。既有配置省略时补缺为关闭。主开关关闭不执行，保留子配置。

Vue 使用消费项目编译器识别 style 块，非批准路径必须声明 scoped 或 module，App.vue 不自动豁免。普通全局样式文件必须在批准目录；CSS Modules 局部规则可在其他目录，但函数式及裸 `:global`、`::v-global` 仍须检查。

选择器 AST 识别全局逃逸，声明字符串、属性值及注释中的同名字样不会误报。此能力不保证运行时视觉无冲突，不分析动态 style 对象或所有跨组件层叠关系。

权重、ID、important 与嵌套统一使用 `checks.stylelint.options.rules`，不存在重复阈值。运行 `npx repo-guard stylelint`，修复后仍需检查页面表现。

[策略](../../src/policies/style-governance.js) · [解析集成](../../src/integrations/stylelint/governance.js) · [测试](../../test/gates/quality/style-governance.test.js)
