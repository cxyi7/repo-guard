# 历史审查说明

本文记录已被替换的 4.2.0 开发方案；其中保留旧入口的设计不再有效。当前 5.0.0 只提供统一入口，见 [当前审查记录](source-security-5.0.0.md)。

# 源码安全 4.2.0 实现与审查记录

本功能基于现有前端工作分支增量实现。未提交、推送或发布，不覆盖已有暂存/未暂存改动。

## 已复现并修复

- HTML 大写原生标签未归一化，`<A HREF="javascript:x">` 漏检。现在仅 HTML 原生标签按大小写不敏感识别，Vue 大写组件不猜测为原生元素。
- `window.open` 重复保护选项的最后禁用值被前面的启用值掩盖。改为按键读取最后一个字面量选项。
- 展开参数被当成缺少 `targetOrigin` 或窗口保护选项误报。现在记录无法确认，不计算展开内容。
- 接入审查中调整了旧 Gate 与新 Gate 的分工：保留原 CI Gate 的模式和范围，避免重复发现；HTML 内联脚本由新 Gate 检查，避免仅含 HTML 时漏检。
- 新测试最初使用错误的 Ajv 默认草案，真实 Schema 为 2020-12；已改用对应校验器。
- npm 离线安装因精确包元数据没有缓存失败；使用授权网络安装精确解析器版本后完成依赖及锁文件更新，未改变检查阈值。

复现日志：`test/.tmp/source-security-review-repro.log`，63 项中新增的三个审查反例失败；修复后重新运行同一测试。其他执行日志存放 `test/.tmp/source-security-*.log`，不进入发布包。

## 补充审查

只检查已有源码的明确语法，不进行动态推导、名称语义猜测、安全封装识别或净化证明。详细支持范围、无法确认与退出码语义见 [源码安全规则](../features/source-security.md)。配置变更、旧命令分工、HTML 内联脚本和任意业务目录均有实际文件/CLI 回归验证。

- 真实 Hook 补测复现仅暂存 HTML、格式工具关闭时未进入质量阶段；将源码安全匹配文件加入调度筛选后，同一测试验证拦截和部分暂存恢复通过。日志：`source-security-hook-repro.log` / `source-security-hook-fixed.log`。
- HTML 边界复核发现 Vue 模板解析器拒绝合法省略结束标签的 HTML；HTML 改用精确版本 `parse5@8.0.1`，Vue 保持专用解析器，并补充合法 HTML 与违规地址共存的测试。
- 旧安全命令的 Doctor 提示改为读取六组配置，不再对已经关闭的分类显示硬性开启。

- 新窗口字面量分隔审查另复现两项绕过：HTML 非 ASCII 空白被当成 rel 分隔符、window.open 选项等号周围空格隐藏禁用值。改用 ASCII 空白规则并归一化等号空白；`source-security-token-repro.log` 保留两个失败反例。
- 最终专项回归 `source-security-verified.log`：165 项全部通过，无跳过。覆盖规则、真实 CLI/Hook、Schema、旧安全命令、CI 模式、门禁登记、配置生命周期、文档与托管规范。

- Windows 定位复核复现 HTML 内联脚本 CRLF 被解析器归一化后行列偏移：原应第 2 行第 1 列，却报为第 1 行第 10 列。脚本分析改为按解析器给出的区间读取原始源码切片；`source-security-location-repro.log` 保留失败，`source-security-location-fixed.log` 中 75 项规则及实际文件/CLI/Hook 测试全部通过。

## 最终验证

- 完整回归：`npm test -- --test-concurrency=4`，1459 项，1443 通过、16 跳过、0 失败，约 308 秒。日志：`test/.tmp/source-security-full-verified.log`。包含最终 HTML 标准解析、CRLF 行列、真实 HTML-only Hook 与部分暂存恢复用例。
- 16 项跳过属于既有 Windows/POSIX 差异、可选真实 k6 及 Java 工具联调；本次源码安全新增测试均真实执行，没有跳过。
- `npm run check` 通过：ESLint、架构边界、语法及中文文案检查通过。日志：`source-security-check-verified.log`。
- `npm run pack:check -- --cache=test/.tmp/npm-cache` 通过：513 个条目，源码安全模块与文档齐全，未包含 test、.agents 或 .git。依赖锁定 `@vue/compiler-dom@3.5.42`、`@vue/compiler-sfc@3.5.42`、`parse5@8.0.1` 为运行时依赖。
- 暂存及未暂存差异的 `git diff --check` 均通过。未提交、推送或发布。
- 开发中的完整回归失败日志仍保留：`source-security-full.log`（旧接口、登记、配置数量和文档同步失败），`source-security-full-final.log`（剩余一项前后端托管规范说明断言失败）。对应问题已修复，最终全量结果如上。
