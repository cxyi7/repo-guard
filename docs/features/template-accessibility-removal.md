# 表单标签与图片替代文本门禁删除说明

[返回功能索引](README.md)

6.0.0 删除原生表单标签和图片替代文本两个固定门禁，不新增替代配置，不保留兼容入口。

- 删除命令：`form-labels`、`image-alt`。
- 删除 Gate ID：`accessibility.vue-form-label`、`accessibility.vue-image-alt`。
- 删除规则：`vue/form-control-label`、`vue/img-alt`。
- pre-commit、CI 与交付复核 和 Doctor 不再执行或列出这两项；初始化不再生成对应 npm scripts；托管 AI 规范不再提出这两项要求。

消费项目升级时，请删除自行保存的 `guard:form-labels`、`guard:image-alt` 脚本以及其他对旧命令的调用，删除 `ci.gatePolicy.gates` 中的两个旧 Gate ID，并清理仅用于两条旧规则的结构化例外。旧命令与旧 CI Gate ID 会报错，不会跳转或静默忽略。按当前规范同步命令重新生成托管 AI 区块；不读取或转换旧格式。

这两项原本没有 checks 开关，Schema 无对应开关可删除。删除仅供这两项使用的模板元素树扫描函数；共享的 Vue 属性、脚本、样式与位置解析器以及 Vue 编译器、Babel 依赖仍用于图片引用、源码安全和异步资源检查；本次不删除 npm 依赖，也不修改消费项目自己的 ESLint 或 Lighthouse 配置。

检查通过不再包含表单标签与图片替代文本的检查证据。源码安全门禁及其六组规则继续按配置执行。
