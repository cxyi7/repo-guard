# 3.2.0 前端图片治理审查

审查日期：2026-09-12。范围是本次图片预设、配置与合并、文件治理、动态图片与引用完整性、显式批量优化和引用更新，以及 Lighthouse 图片审计、页面守卫、报告与门禁入口。没有把此前所有前端工具和 Java 功能都算作本次重新审查。

采用源码检查、先失败后通过的回归用例、真实文件与 Git 仓库、Sharp 编解码、写入故障注入，以及真实 Chrome/LHCI 联调。测试中的虚拟 DOM 只用于确定性反例，浏览器行为另行实测。

## 已复现并修复

| 问题 | 反例和修复后的行为 |
|---|---|
| 审计错误被空分数掩盖 | `score=null` 且审计执行错误必须为执行错误，保留第三方诊断 |
| 严格模式缺少审计仍放行 | 必需审计缺失返回配置错误；只报告模式明确提示未验证 |
| 图片传输量按零兜底 | 缺失、负数、字符串均拒绝，不能产生虚假的预算通过证据 |
| 路由预算无法对应页面 | 拒绝非法 URL、规范化后重复地址及未配置页面 |
| 自定义图片映射被默认 img 抢先处理 | 自定义属性优先；尚未请求的 data-src 不报损坏 |
| failedRequests 开关未完全生效 | DOM 与网络检测遵守开关，真实损坏图片按严格模式阻断 |
| 页面观察使用错误设备和路由范围 | 使用消费项目 Lighthouse 设备配置，只验证当前 LHCI URL 对应页面 |
| 动态片段误判为本地完整路径 | 动态拼接片段及远程 new URL 基址不参与本地缺失引用检查 |
| 关闭扩展仍加载 Sharp | 全部相关治理子项关闭时不隐式要求 Sharp |
| 格式扩展名与实际编码不一致 | jpg/tif 正确对应 jpeg/tiff |
| 输出写入后临时清理失败留下半成品 | 在输出建立时登记回滚，故障注入后本批输出恢复 |
| 关闭位图压缩仍可执行原格式优化 | 明确报配置错误，不继续编码 |
| 重跑没有独立失败诊断 | 失败后成功重跑，两份 result.json 路径不同，旧内容不变 |
| 引用完整性未应用人工例外 | 使用真实行列，精确匹配有效例外 |
| 增量引用检查阻断原有债务 | 比较基线引用，仅新增或变更的位置/目标重新阻断 |
| 检查大小之前读取整张图片 | 文件读取监测反例确认，超限资源在哈希读取前阻断 |
| GIF 元数据检查漏检 Sharp | Doctor 对仅 GIF/TIFF 治理也校验消费项目依赖 |

同时补强报告衔接：开启图片检查缺少页面或本轮观察证据时拒绝通过；报告解析失败保留采集诊断；页面地址统一规范化；摘要统一为 v2。批量回滚尝试恢复全部已写项，发生外部修改时保留现场并报告未恢复路径。

## 可重复验证入口

- `test/integrations/image-review-regressions.test.js`：审计、URL、DOM、依赖、格式和输入安全上限。
- `test/gates/repository/image-assets.test.js`：真实 Sharp、Git 及写入失败恢复。
- `test/gates/repository/unused-image-assets.test.js`：真实引用位置、人工例外和 Git 基线增量。
- `test/gates/quality/lighthouse.test.js`：执行状态、独立诊断和失败后重跑。
- `test/integrations/frontend-performance.test.js`：生成守卫、构建证据、页面报告与观察完整性。

本地先失败日志保存在 `test/.tmp/image-review-before.log`（10 项）、`image-review-write-before.log`（2 项）、`image-review-journal-before.log`（1 项）、`image-review-reference-before.log`（2 项）、`image-review-limits-before.log`（2 项）。这些临时日志不会随 npm 发布；长期复现依据是上述测试。

## 历史错误和验证边界

上次首次 Lighthouse 采集失败的原始 stderr 已被重跑覆盖，无法可靠恢复根因。本次发现的问题不能倒推为那一次失败的原因。

本次真实 Vite/Vue 构建和三轮 Lighthouse 已通过，使用消费项目 LHCI 0.15.1、Lighthouse 12.6.1、Chrome 155，没有降低性能阈值。补充真实浏览器验证确认自定义 data-src、损坏图片开关、390px 视口及 DPR 3。独立 Puppeteer 测试的 Chrome 关闭曾停滞，定位到测试清理阶段后改用专属 Chrome 进程树清理；串行重跑的全部断言及清理均完成。并发故障实验曾先遇到导航 `net::ERR_ABORTED`；串行重新制造业务最终地址错误后，确认 LHCI 正确返回执行错误，独立记录保留明确原因。两次诊断各自保存，不把先遇到的错误冒充预定反例。

独立诊断保留结构化结果及公共长度上限内的脱敏输出，不声称保留无限制原始日志。LHCI 的 `.lighthouseci` 原始报告仍可能被下一次运行替换。动态接口的全量取值、未访问状态、图片视觉质量仍需业务测试及人工验收，静态扫描不得据此自动删除资源。

本轮未新增 Skill，未提交、推送或发布。

## 本轮验证证据

- 修复前 17 项反例全部失败；修复后关联测试 85/85 通过。
- 真实三轮 Lighthouse 成功记录：`test/.tmp/frontend-performance-runtime/reports/lighthouse-runs/1789216291692-a44cc92b-9a90-4657-9609-c848d45faaaf/result.json`。
- 并发实验导航错误记录：同目录 `1789216635537-a2742617-752c-4f01-a770-56d7a7011be7/result.json`。
- 串行错误页面反例记录：同目录 `1789216923804-98b7023d-5522-4d5a-bb8f-8314af6c467a/result.json`，明确包含最终地址不符合配置。
- 真实 DOM 断言及专属进程清理完成：`test/.tmp/image-review-real-dom-final.log`。
- 打包检查通过；只检查发布包，没有执行发布。

最终全量复跑：1351 项，通过 1335，失败 0，跳过 16（Windows POSIX 信号差异与未启用的 Java/k6 集成），用时约 399 秒。日志为 `test/.tmp/image-review-full-verified.log`。`npm run check` 的 ESLint、依赖架构、语法与中文文案检查全部通过，`git diff --check` 无差异格式错误。
