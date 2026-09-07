# 无效代码与基线

使用项目自己的 Knip 检查全项目依赖图，并支持逐步清理历史债务。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

无效代码门禁默认关闭，使用消费项目自己安装的 Knip 6.x 和 `knip.*` 配置；repo-guard 不内置业务入口、不替项目猜测工作区边界，也不会回退到自身的开发依赖。

```bash
npm install --save-dev --save-exact knip@6.31.0
npx repo-guard enable deadCode
npx repo-guard dead-code
```

```json
{
  "deadCode": {
    "enabled": true,
    "mode": "strict",
    "configFile": "knip.json",
    "baselineFile": ".repo-guard/knip-baseline.json",
    "timeoutMs": 180000,
    "production": false,
    "issueTypes": ["files", "dependencies", "unlisted", "binaries", "unresolved", "exports", "types"],
    "treatConfigHintsAsErrors": true
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `deadCode` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否在 pre-push 和 ci-full 中运行无效代码门禁；手动命令始终可以显式执行 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `mode` | strict 拒绝任何问题；noRegression 仅允许已登记且与当前结果同步的历史问题 | `"strict"` / `"noRegression"`<br>默认：`"strict"` | 只接受列出的值 |
| `configFile` | 仓库内 Knip 配置文件；null 使用 Knip 官方配置发现顺序 | 字符串 / null<br>默认：`null` | 非 null 时：至少 1 个字符 |
| `baselineFile` | noRegression 模式使用的仓库内、非符号链接且由 Git 跟踪的基线文件 | 字符串<br>默认：`".repo-guard/knip-baseline.json"` | 至少 1 个字符 |
| `timeoutMs` | Knip 子进程最大运行时间 | 整数<br>默认：`180000` | ≥ 1 |
| `production` | 是否启用 Knip production 模式，仅分析生产代码 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `issueTypes` | 由 repo-guard 强制请求并转换为中文问题的 Knip 问题类型 | 数组；每项可选 `"files"`、`"dependencies"`、`"unlisted"`、`"binaries"`、`"unresolved"`、`"exports"`、`"types"`<br>默认：`["files","dependencies","unlisted","binaries","unresolved","exports","types"]` | 至少 1 项；元素不可重复 |
| `treatConfigHintsAsErrors` | Knip 配置提示必须作为错误处理，避免在不完整项目图上建立基线 | 只能为 `true`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

- `strict`：发现任意已启用类型的问题都直接阻断，适合新项目或已清零项目。
- `noRegression`：允许已经审核并登记的历史问题，但拒绝新增问题、陈旧条目和分支扩大基线，适合旧项目渐进治理。
- `issueTypes` 中的 `dependencies` 是统一策略类型，会同时启用并归一化 Knip 的 `dependencies`、`devDependencies` 和 `optionalPeerDependencies`，避免开发依赖漏检。
- Knip 配置提示始终作为配置错误处理，避免因入口、插件或工作区配置不完整而得到虚假的“无问题”结果。
- 检查按完整项目依赖图运行，因此只进入手动命令、可选 pre-push 和 CI full，不进入 pre-commit；局部未使用变量仍由消费项目 ESLint 负责。
- `production: true` 只分析 Knip 定义的生产范围；启用前应确认测试、脚本和开发依赖不属于当前治理目标。

旧项目第一次接入时使用基线模式：

```bash
npx repo-guard enable deadCode
# 将 deadCode.mode 改为 noRegression，并先完成 Knip 配置
npm run guard:dead-code-baseline-init
git add .repo-guard/knip-baseline.json
git commit -m "chore: 初始化无效代码基线"
npm run guard:dead-code
```

基线由问题类型、仓库相对路径、名称和命名空间生成 SHA-256 指纹，并记录重复数量。运行门禁时，当前 Knip 结果必须和基线完全同步：新增问题会阻断；问题修复后保留的陈旧条目也会阻断。确认只删除已解决债务后运行：

```bash
npm run guard:dead-code-baseline-prune
git diff -- .repo-guard/knip-baseline.json
git add .repo-guard/knip-baseline.json
```

`init` 拒绝覆盖现有文件；`prune` 拒绝接纳任何新增问题。pre-push 和 CI full 还会把当前基线与 Git 基准提交比较，阻止通过手工修改、重新生成或增加计数扩大历史债务；纯文件重命名会按 Git 重命名关系映射，不会制造新债务。基线必须位于仓库内、不得经过符号链接、必须由 Git 跟踪，`issueTypes` 变化后需要先清理真实问题并重新评审接入方案，不能用重建基线绕过检查。

## 执行与复核

执行入口：手动、pre-push 和 CI full。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/quality/project-quality-gates.js) · [对应测试](../../test/dead-code.test.js)
