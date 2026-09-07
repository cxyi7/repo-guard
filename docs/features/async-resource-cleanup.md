# Vue 异步资源清理

检查组件与组合函数创建的异步资源是否有可靠的生命周期清理。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

异步资源清理默认关闭，可通过 `npx repo-guard enable asyncResourceCleanup` 启用。启用后发现的问题全部按 `error` 阻断，不提供自动修复：

```json
{
  "preCommit": {
    "asyncResourceCleanup": {
      "enabled": true,
      "include": ["src/**/*.vue", "src/**/composables/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
      "exclude": ["**/*.d.ts", "**/*.spec.*", "**/*.test.*", "**/generated/**"],
      "extensions": [".vue", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
      "timeoutThresholdMs": 1000,
      "requestFunctions": ["fetch", "api.request"]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `preCommit.asyncResourceCleanup` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否在 pre-commit 和启用的 CI 门禁中强制检查异步资源清理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `include` | 仓库相对 glob；默认检查 Vue 页面以及任意层级 composables 目录 | 字符串数组<br>默认：内置 3 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；每项为非空字符串 |
| `exclude` | 仓库相对 glob；排除优先级高于 include | 字符串数组<br>默认：`["**/*.d.ts","**/*.spec.*","**/*.test.*","**/generated/**"]` | 允许空数组；每项为非空字符串 |
| `extensions` | 允许进入异步资源清理检查的扩展名白名单 | 数组；每项可选 `".vue"`、`".js"`、`".jsx"`、`".ts"`、`".tsx"`、`".mjs"`、`".cjs"`<br>默认：`[".vue",".js",".jsx",".ts",".tsx",".mjs",".cjs"]` | 至少 1 项；元素不可重复 |
| `timeoutThresholdMs` | 达到此延迟的 setTimeout 必须保存句柄并在生命周期结束时清理；动态延迟按需要清理处理 | 整数<br>默认：`1000` | ≥ 0 |
| `requestFunctions` | 需要传入 AbortController.signal 并在卸载时 abort 的请求函数或静态成员路径 | 字符串数组<br>默认：`["fetch"]` | 至少 1 项；元素不可重复；每项：匹配格式 `"^[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*$"` |

<!-- config-fields:end -->

- 使用 Babel AST 按绑定身份匹配创建与释放，不用文本正则猜测；Vue 文件复用共享 script 扫描器，跳过 template、style、注释和外部 `src` script。
- 检查 `setInterval`、达到阈值或动态延迟的 `setTimeout`、已保存或递归的 `requestAnimationFrame`、事件监听器、Observer、WebSocket/EventSource/BroadcastChannel、Worker、订阅和定位监听。
- `addEventListener` 必须用相同目标、静态事件名、稳定回调和相同 `capture` 移除；`once: true` 可直接通过，`signal` 方式要求对应控制器在生命周期结束时 `abort()`。
- `requestFunctions` 中的请求必须传入可静态追踪的 `AbortController.signal`，并在卸载时 `abort()`；动态拼装且无法证明 signal 归属的写法会阻断。
- 支持 `onBeforeUnmount`、`onUnmounted`、`onScopeDispose`、Options API 卸载钩子和 Vue 2 销毁钩子；`onActivated` 中创建的资源必须在 `onDeactivated` 释放。清理可通过本地 helper 间接调用，但在 `await` 后才注册或执行的清理不算可靠。
- 短于阈值的定时器和 `new Promise(resolve => setTimeout(resolve, ...))` 延时写法不检查；同一句柄存在多个静态创建点时会额外报告覆盖风险。
- 可使用结构化例外临时批准精确规则、文件和位置；普通注释、ESLint/Stylelint 的 disable 注释或项目 lint 配置不能替代该规则的例外审批。团队仍可通过 `npx repo-guard disable asyncResourceCleanup` 关闭自动检查；显式手动命令会运行检查。

## 执行与复核

执行入口：手动、pre-commit、CI policy/full 和 release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/quality/vue-async-resource-cleanup-gate.js) · [对应测试](../../test/async-resource-cleanup.test.js)
