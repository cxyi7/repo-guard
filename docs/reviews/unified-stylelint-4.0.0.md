# 统一 Stylelint 审查与验证记录（4.0.0）

日期：2026-09-13。分支：`refactor/unified-stylelint-4.0.0`。本轮未提交、推送或发布。开始时已有前端工具、维护、测试、性能和图片治理的未提交修改，本次保留这些工作，不把它们算作本轮新增。

## 范围与已确认契约

- 只保留 `checks.stylelint` 作为公开样式入口；普通规则在 `options`，隔离与全局路径在 `governance`，设计变量在 `uiTokens`。
- 原生用户配置优先，复杂度、ID、important、权重只检查最终规则，不重复执行。删除旧顶层字段、独立启用名和执行命令；按仓库规则拒绝旧格式，不增加迁移读取器。
- 新前端默认开启 Stylelint 与治理；全局目录默认根 `styles/**`。Token 仍关闭，建立设计规范后启用。
- 关闭主开关停止执行但保留子配置。内部 Token 步骤保留全量只读复查及暂存隔离；手动入口统一汇总各子检查。
- 新增运行依赖 `postcss-selector-parser@7.1.4`；Vue 编译器来自消费项目，声明可选 peer `vue >=3.5 <4`。未卸载消费项目依赖，不生成接入 Skill。

## 真实问题、复现与修复

| 编号 | 复现和实际结果 | 根因与修复 | 证据 |
|---|---|---|---|
| S01 | 旧实现对 `card.module.css` 中 `:global .external { color: red; }` 返回 0 项违规 | 原先按 `.module.*` 整体放行；现提取选择器 AST，函数式及裸 global 均检查 | `test/.tmp/stylelint-old-governance-repro.log`；`test/gates/quality/style-governance.test.js` |
| S02 | 旧 Vue 实现将 `content: ":global(body)"` 报为全局逃逸（1 项） | 正则扫描整个样式内容；改为选择器 AST，字符串和属性值不进入伪类判断 | 同上，另有真实 Vue 属性值、声明字符串回归 |
| S03 | 合并过程中，仅暂存应用配置或根配置时，2 项已有 Token 回归由应阻断变成成功 | Hook 用暂存样式数量临时关闭统一主开关，连带关闭 Token；保留用户主开关，普通规则由文件选择独立跳过 | `stylelint-token-hook-before.log`：6 项中 2 失败；`stylelint-token-hook-final.log`：Hook/CI 共 10 项全部通过 |
| S04 | 审查发现 Token 默认只包含 src，与根 styles 目录约定不一致 | 默认扫描补充 `styles/**/*.{css,scss,sass,less}`，清单及 Schema 同步；真实根目录原始颜色阻断、登记变量通过 | `test/integrations/unified-stylelint.test.js`，`stylelint-unified-command-first.log` |
| S05 | 原生违规与缺失 Token 清单同时出现 | 统一命令不能只返回第一个非零结果；改用公共聚合并保留所有发现，配置错误优先 | 同上，真实 Stylelint 空块违规加缺失清单返回 configuration-error |

S01/S02 的“旧实现”来自当前仓库 HEAD 的策略文件，只复制到忽略的测试临时目录进行对照，不加入运行时兼容路径。修复后用实际消费项目 Stylelint、Vue、SCSS/Less 解析验证，不以模拟返回代替。

## 开发中失败的完整说明

- 初始统一配置回归 3 项失败，记录在 `stylelint-unification-before.log`；新结构实现后通过。
- 第一轮配置改动曾误删公共默认值块，已立即恢复；后端检查白名单还遗留旧字段，导致 Java 读取不存在的 enabled，已删除遗留项。后续全量配置及 Java 测试覆盖。
- Schema 条件分支一度把治理子对象设成空属性且禁止附加字段，已修复为保持条件限制，不覆盖完整子 Schema。
- 第一轮全量：1361 项，1332 通过、13 失败、16 跳过。13 项分别为 2 个旧架构接口断言、4 个尚未更新的文档契约、2 个与“用户原生配置优先”冲突的旧 Hook 断言、1 个被测试辅助函数误补 options 的缺失配置用例、2 个 S03 真实漏检、2 个仍将主开关关闭的旧 Token 测试配置。日志 `stylelint-unified-full-first.log` 完整保留。
- 缺失配置测试恢复为确实没有内联及原生配置，仍要求配置错误；原生覆盖测试改为验证已确认的覆盖契约，并保留严格规则正反例，不降低运行规则来迎合测试。
- 新增混合 Vue 语言样例第一次失败，原因是现有单文件单语言约束，非解析器新缺陷。保留约束并验证明确拒绝；独立 SCSS/Less 插值实测通过。日志 `stylelint-interpolation-first.log`、`stylelint-interpolation-second.log`。
- lint 曾发现 3 个已无用途的旧常量导入，删除后 `npm run check` 通过，未增加白名单。
- npm 锁文件安装在受限环境的首次调用中断，随后正常完成；大型文档写入命令出现工具管道错误，拆分写入并通过文档 Schema 测试。均未将失败当作成功，也未覆盖失败日志。

## 验证范围

- 真实 Stylelint 规则执行、用户规则参数与关闭值覆盖、CSS 权重 `0,3,1`、变量缺少 var、重复自定义属性、忽略文件跳过、错误分类、修复恢复。
- 真实 Vue 编译器与选择器 AST：scoped/module、批准目录、非批准全局、CSS Modules 两种逃逸、字符串误报、非法 SFC、SCSS/Less 插值。
- 实际 CLI、仅内联 Token 配置、主开关停用、错误聚合、旧命令拒绝；根 styles 下 Token 正反例。
- Token 配置变化、源变化、删除源、多应用隔离、Hook 暂存与未暂存保护；普通 Hook 执行顺序保持不变。
- 配置/Schema/文档/功能登记、初始化、Doctor、CI、Java 与交付等由完整仓库回归覆盖。

### 最终结果

- 完整回归：`npm test -- --test-concurrency=4`，1363 项，1347 通过、16 跳过、0 失败，耗时 304.825 秒；日志 `test/.tmp/stylelint-unified-full-final.log`。真实 Stylelint、Vue、Token 与 Hook 用例均执行，不在跳过项内。
- 配置、文档和命令定向：324 项全部通过；`stylelint-targeted-final.log`。
- 真实完整预设及工具集成：15 项全部通过；`stylelint-preset-real-final.log`。
- Hook 文件回归：47 项全部通过；`stylelint-hook-focused.log`。
- Token Hook/CI 回归：10 项全部通过；`stylelint-token-hook-final.log`。
- `npm run check` 通过：ESLint、架构（386 模块、1639 条依赖）、语法、中文文案；`stylelint-check-final.log`。
- `npm run pack:check` 通过，仅 dry-run，未发布；`stylelint-pack-final.log`。
- 最终工作区相对 HEAD 的 `git diff HEAD --check` 通过。已有暂存状态保留，后续修复仍在工作区；本轮未创建提交。

环境条件跳过项保持原有策略，涉及外部工具或平台专用验证，未将跳过计作通过。此前失败日志保留，修复没有降低规则、覆盖率或其他质量阈值。

## 适用边界

- 普通 Stylelint 门禁仍要求每个 Vue 文件只使用一种 style 语言；Token 解析器本身能处理多语言事实，不代表普通门禁取消该限制。
- 不推断动态 style 对象或保证页面视觉一致；独立 CSS 默认设置 specificity，预处理器和 Vue 不统一套用编译后权重。
- Token 清单和项目依赖仍需接入者准备；Skill 仅记入待办。禁止全部颜色字面量、禁止全部 px 和 no-descending-specificity 未默认启用。
- 本轮未进行部署、npm 发布或新的 Lighthouse 浏览器采集。全量中标记跳过的环境测试不会作为成功的真实联调证据。
## 后续调整：移除图标尺寸专项（2026-09-13）

按用户确认移除 iconSelectors 配置、icon-size 清单类别、选择器图标身份推断和对应宽高限制。运行时、Schema、默认值、托管规范及功能文档同步更新；保留其他分类及清单校验。旧图标字段明确拒绝，不自动迁移。

新增真实 Stylelint 回归：.ui-icon 的宽度、.ui-icon .label 的百分比宽度、svg.chart 的高度正常通过；同文件中的原始颜色仍被阻断。相关配置、策略、真实解析、Hook、CI、统一命令及文档回归 90 项全部通过，日志 test/.tmp/token-icon-removal-final.log。首轮失败是托管规范测试仍期待已删除的 .app-icon 文案，更新为验证不再生成图标规范后通过，失败日志保留。

后续增加清单类别拒绝回归，结果单独保存于 test/.tmp/token-icon-removal-schema.log；本轮代码质量检查见 test/.tmp/token-icon-removal-check.log。此前 1363 项全量结果属于前一轮，不作为本次删除后的重新全量结果。

本次仅移除图标能力，其余分类开关、定位属性范围、媒体查询精确分类、计算与回退值处理尚未修改。下一步清单中区分源码可识别事实与依赖设计清单的判断，不承诺自动识别业务含义。
