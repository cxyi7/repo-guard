# Lighthouse

[功能索引](README.md) · [完整前端预设](frontend-performance-presets.md)

使用 Vue 消费项目的 @lhci/cli、Puppeteer 和 Chrome 自动打开浏览器、采集页面并执行断言；人可以打开 .lighthouseci 的 HTML 报告检查结果。默认仅性能分类，不恢复组件交互或 axe 测试。工具约定见 [Lighthouse CI 官方配置](https://googlechrome.github.io/lighthouse-ci/docs/configuration.html)。

## 配置与接入

前端首次创建默认开启；实际脚本、Chrome、生产预览、URL 和业务选择器当前由接入者填写，自动化要求见 [Skill 接入待办清单](skill-integration-backlog.md)。内联 options 与原生 lighthouserc JSON/YAML/JS/CJS/MJS 合并，对象递归、数组整项替换、原生优先，不写回用户文件。显式文件不存在会报错。

<!-- config-fields:start -->
| 字段 | 初始值与约束 |
|---|---|
| `checks.lighthouse.enabled` | 前端初始化 true；普通补缺 false，手动命令可显式执行 |
| `checks.lighthouse.prePush` | 前端初始化 false，单独选择推送前检查 |
| `checks.lighthouse.configFile` | null，读取标准文件；显式路径必须存在且在项目内 |
| `checks.lighthouse.buildScript` | build，页面验证需要生产构建及产物证据 |
| `checks.lighthouse.timeoutMs` | 前端预设 600000ms，分别应用于构建/collect/assert |
| `checks.lighthouse.pages` | 初始空数组；每项提供 url、expectedUrl、selector，逐项对应最终采集 URL |
| `checks.lighthouse.options` | 三次中位数，桌面性能：90 分、FCP 1800ms、LCP 2500ms、TBT 200ms、CLS 0.1 |
<!-- config-fields:end -->

不能用空路由完成接入。选择项目真实首页、列表、详情或重页面，用稳定业务标识确认页面，不能只检查通用 #app。需登录时先调用用户 puppeteerScript，通过环境变量读取凭据。配置 startServerCommand 启动本轮产物目录的生产预览并严格匹配端口；staticDistDir 自动改端口，与当前精确 URL 验证不兼容。

## 执行与报告

手动 lighthouse、CI full、release-ready 按配置执行，pre-push 可选，不进入 pre-commit。同一进程只复用输入和产物指纹均一致的已通过构建，单独命令先真实构建。--skip-build 缺少可验证同轮证据时返回配置错误，另一次命令留下的产物不会自动获准复用。

页面守卫验证 HTTP 状态、最终地址和业务 selector；采集后逐页验证报告数量、时间、运行错误和最终 URL。旧报告、缺页、错误页面、超时、取消属于执行错误；性能断言失败属于违规。检测期间源码、配置或产物变化需重跑。

.lighthouseci 保存原始报告与 repo-guard-summary.json。摘要关联构建指纹，记录 Lighthouse/Node 版本、Chrome 用户代理、性能指标、实际资源传输和解压体积，不保存认证头。LHCI 管理预览及 Chrome，公共进程树处理取消与超时；只执行 collect/assert，不执行 upload/autorun。

本地产物指纹无法证明任意外部 URL 的发布版本；使用本轮生产预览验证。自动性能检查不替代业务人工验收。

[实现](../../src/gates/quality/lighthouse-gate.js) · [测试](../../test/integrations/frontend-performance.test.js)

## 前端预设扩展

前端初始化及显式启用的可编辑全量图片预设、接口/响应字段保留依据、预算、动画、元数据处理、页面图片审计及批量引用更新见[前端图片治理预设](frontend-image-presets.md)。默认执行范围现为 allFiles；changedFiles 仍可由用户显式选择。

## 每次执行的独立诊断

每次执行在应用目录的 `reports/lighthouse-runs/<时间戳>-<随机标识>/result.json` 保存 v2 诊断，产物类型为 `lighthouse-run`；重跑不会覆盖旧记录。内容包含起止时间、结构化状态和已脱敏的第三方输出；沿用公共输出长度上限，截断通过标记说明，不能将其称为无限制原始日志。配置预检异常仍按原入口抛出，记录可从上述目录查看。

报告解析失败保留此前构建与采集诊断。当前 LHR 原始报告仍由 LHCI 写入 `.lighthouseci`，可能被下次采集替换；需要保存完整原始报告时应另行归档。repo-guard 摘要使用 v2，不读取旧摘要作为通过依据。

图片审计和设备配置边界见 [图片预设](frontend-image-presets.md#审查后的执行边界)。
