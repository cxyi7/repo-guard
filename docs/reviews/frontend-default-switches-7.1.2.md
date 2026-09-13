# 前端默认开关 7.1.2 审查记录

## 已确认遗漏与修复

1. 前端维护预设没有写入 typeCheck.enabled，导致 TypeScript 新建配置回退为关闭，createProjectDocument 也因此没有写入对应工具 options。现在 TypeScript 新预设开启并写入 vue-tsc 严格选项，JavaScript 保持关闭。
2. Stylelint 的 uiTokens 主开关仍为 false。按本次确认改为新前端预设开启，未伪造设计清单。values 与 artifacts 子能力仍需项目明确配置后启用。
3. 使用说明部分初始状态仍写为关闭；Schema 的“已存在脚本才启用”说明不符合显式预设原则。已同步默认状态和 Schema 说明，通用读取回退不变。

## 验证与边界

- 63 项前端维护、原生工具、统一 Stylelint、Token 清单与配置管理测试全部通过。
- 49 项配置、CLI 与文档测试全部通过。
- 最终 10 项工具联调测试全部通过，包含直接使用新建配置运行真实 vue-tsc：错误类型产生违规，修复为正确值后通过。
- 新增完整前端主开关断言，区分 TypeScript、JavaScript 和后端，防止再次漏写开关。既有显式关闭值保持不变。
- 缺少 Token 清单明确产生 ui-token/file-missing，不作为通过；本轮不替项目编造 Token 定义。
- 工程检查及打包清单检查通过。本轮未重复运行全仓完整测试，不将前一版本的完整回归计作本轮结果。

本次为初始化预设修复，未新增依赖或修改类型分析、Token 分析算法。repository.codePlacement 继续关闭，图片报告动作及需要真实项目输入的范围不在本轮自动改变。
