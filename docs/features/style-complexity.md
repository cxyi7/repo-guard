# Stylelint 复杂度规则

[统一配置](stylelint.md) · [功能索引](README.md)

复杂度合并至 `checks.stylelint.options.rules`，不再提供独立开关、命令或第二份阈值。

| 原生规则                        | 前端预设                          |
| ------------------------------- | --------------------------------- |
| selector-max-compound-selectors | 3                                 |
| max-nesting-depth               | 3                                 |
| selector-max-specificity        | 独立 CSS 文件 0,3,1；其他语法关闭 |
| selector-max-id                 | 0                                 |
| declaration-no-important        | true                              |

SCSS/Less 嵌套及混合 Vue 不能一概按编译后 CSS 计算权重，因此不统一套用 specificity。需要时按项目语法单独配置并实测。用户原生同名规则优先，包括 null 关闭值。

运行 `npx repo-guard stylelint`，减少层级、拆分职责并复核页面效果，不通过弱化规则消除失败。

[真实规则测试](../../test/gates/quality/style-complexity.test.js)

当前普通 Stylelint 门禁仍要求每个 Vue 文件只使用一种 style 语言；混用会返回配置错误，不能视为已支持。
