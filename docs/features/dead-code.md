# 无效代码与基线

使用项目自己的 Knip 检查全项目依赖图，并支持逐步清理历史债务。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`。

前端新建预设默认开启核心检查，Node 后端通用默认仍关闭；已有配置不因升级自动改写。使用消费项目自己安装的 Knip 6.x（内联配置至少 6.31.0）和原生配置；repo-guard 不内置业务入口、不替项目猜测工作区边界，也不会回退到自身的开发依赖。

```bash
npm install --save-dev --save-exact knip@6.31.0
npx repo-guard enable deadCode
npx repo-guard dead-code
```

```json
{
  "checks": {
    "deadCode": {
      "enabled": true,
      "mode": "strict",
      "configFile": null,
      "options": {
        "includeEntryExports": false,
        "ignoreExportsUsedInFile": false,
        "ignoreDependencies": [],
        "ignoreBinaries": [],
        "ignoreUnresolved": [],
        "ignoreFiles": []
      },
      "baselineFile": ".repo-guard/knip-baseline.json",
      "timeoutMs": 180000,
      "production": false,
      "issueTypes": [
        "files",
        "dependencies",
        "unlisted",
        "exports",
        "types"
      ],
      "treatConfigHintsAsErrors": true
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.deadCode.enabled` | 是否在 pre-push 和 ci-full 中运行无效代码门禁；手动命令始终可以显式执行 | `true` / `false`<br>默认：通用 `false`，前端新建预设 `true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.deadCode.options` | 可修改的 Knip JSON 预设；未知原生字段由项目 Knip 校验 | 对象，可省略；前端写入上述基础选项 | 原生配置优先，数组整体替换；不能嵌入函数或原型属性 |
| `checks.deadCode.mode` | strict 拒绝任何问题；noRegression 仅允许已登记且与当前结果同步的历史问题 | `"strict"` / `"noRegression"`<br>默认：`"strict"` | 只接受列出的值 |
| `checks.deadCode.configFile` | 仓库内 Knip 配置文件；null 在当前应用按 Knip 官方顺序发现配置；内联模式不读取应用外祖先配置 | 字符串 / null<br>默认：`null` | 非 null 时：至少 1 个字符 |
| `checks.deadCode.baselineFile` | noRegression 模式使用的仓库内、非符号链接且由 Git 跟踪的基线文件 | 字符串<br>默认：`".repo-guard/knip-baseline.json"` | 至少 1 个字符 |
| `checks.deadCode.timeoutMs` | Knip 子进程最大运行时间 | 整数<br>默认：`180000` | ≥ 1 |
| `checks.deadCode.production` | 是否启用 Knip production 模式，仅分析生产代码 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.deadCode.issueTypes` | 由 repo-guard 强制请求并转换为中文问题的 Knip 问题类型 | 数组；每项可选 `"files"`、`"dependencies"`、`"unlisted"`、`"binaries"`、`"unresolved"`、`"exports"`、`"types"`<br>通用默认：`["files","dependencies","unlisted","binaries","unresolved","exports","types"]`；前端默认移除 `binaries`、`unresolved`，JavaScript 另移除 `types` | 至少 1 项；元素不可重复 |
| `checks.deadCode.treatConfigHintsAsErrors` | Knip 配置提示必须作为错误处理，避免在不完整项目图上建立基线 | 只能为 `true`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

- `strict`：发现任意已启用类型的问题都直接阻断，适合新项目或已清零项目。
- `noRegression`：允许已经审核并登记的历史问题，但拒绝新增问题、陈旧条目和分支扩大基线，适合旧项目渐进治理。
- `issueTypes` 中的 `dependencies` 是统一策略类型，会同时启用并归一化 Knip 的 `dependencies`、`devDependencies` 和 `optionalPeerDependencies`，避免开发依赖漏检。
- Knip 配置提示始终作为配置错误处理，避免因入口、插件或工作区配置不完整而得到虚假的“无问题”结果。
- 检查按完整项目依赖图运行，因此只进入手动命令、可选 pre-push 和 CI full / release-ready，不进入 pre-commit；局部未使用变量仍由消费项目 ESLint 负责。
- `production: true` 只分析 Knip 定义的生产范围；启用前应确认测试、脚本和开发依赖不属于当前治理目标。

旧项目经负责人确认接受已有债务后，可以显式使用基线模式；默认仍为严格模式，接入不能自动生成基线：

```bash
npx repo-guard enable deadCode
# 将 checks.deadCode.mode 改为 noRegression，并先完成 Knip 配置
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

基线只生成并接受 `schemaVersion: 2`。版本 1、缺少版本或其他版本都会被拒绝；`prune` 不会自动转换旧文件。已有旧基线需重新评审历史债务并按当前格式登记，不能只改版本号冒充完成复核。

`init` 拒绝覆盖现有文件；`prune` 拒绝接纳任何新增问题。pre-push 和 CI full / release-ready 还会把当前基线与 Git 基准提交比较，阻止通过手工修改、重新生成或增加计数扩大历史债务；纯文件重命名会按 Git 重命名关系映射，不会制造新债务。基线必须位于仓库内、不得经过符号链接、必须由 Git 跟踪，`issueTypes` 变化后需要先清理真实问题并重新评审接入方案，不能用重建基线绕过检查。

## 执行与复核

执行入口：手动、pre-push 和 CI full / release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/quality/project-quality-gates.js) · [对应测试](../../test/gates/quality/dead-code.test.js)

## 前端初始化模板

前端初始化的开关、目录、规则及新增字段见[前端维护预设](frontend-maintenance-presets.md)；既有项目读取配置不会被自动改写。

## 前端内联配置与接入边界

前端新建预设及显式 enable 默认开启 files、dependencies、unlisted、exports，TypeScript 预设另开启 types；binaries、unresolved 保持可选，避免与环境及架构检查重复。通用 Node 默认保持不变，已有配置读取不会被改写。启用时补齐缺失预设，用户已有数组整体优先；重复启用不重复追加。

checks.deadCode.options 保存可修改的 Knip JSON 配置。应用原生配置优先，嵌套对象按字段补缺、数组整项替换；用户函数、正则及自定义编译器保留原样。configFile 明确指定时使用该文件，否则内联模式仅在当前应用按 Knip 的配置发现顺序查找，包含 package.json#knip，不读取无关祖先配置。JS/TS 动态配置由项目自己的 Knip 在受超时控制的子进程中加载，临时配置清理后不写入用户源码或原生文件。

entry、project、paths、workspaces 和实际插件不预设固定目录；Skill 后续从实际 HTML、构建、路由、测试、脚本和工作区配置补齐。Knip 自己已经识别的插件和入口不重复配置。显式 entry/project 为空数组或路径模式没有匹配文件时阻断；由插件发现时省略相应字段；Knip 零处理计数也阻断。处理计数可能包含配置文件，不能单凭计数证明入口或动态使用完整覆盖。

将所有源码设为 entry 会掩盖未使用文件，Skill 不得这样消除报告。动态加载、自动导入和对外入口只按实际配置或明确登记确认；检查通过只代表配置的静态分析范围，不证明运行时永不使用，也不自动删除文件、导出或依赖。includeEntryExports 默认为 false，ignoreExportsUsedInFile 默认为 false；未使用导出可能只需移除 export。

workspace、别名、本地路径等特殊依赖引用对应的依赖问题跳过；普通未使用依赖继续报告，不允许跨应用同名依赖互相掩盖。源码中的普通相对导入无法解析时不会因其看起来像路径而跳过。特殊引用本身仍可能使第三方工具无法执行；启动失败或格式错误不会被伪装为通过。

工具就绪清单登记 Knip >=6.31.0 <7、TypeScript 和 @types/node，接入时仍应核对项目 Node 与 peer 版本。当前 Doctor 检查安装与基线条件；完整原生配置及分析验证必须实际运行 dead-code，不能把 Doctor 通过当作 Knip 分析通过。

[内联合并](../../src/integrations/knip/configuration.js) · [特殊引用过滤](../../src/integrations/knip/special-references.js) · [真实消费项目测试](../../test/integrations/frontend-dead-code.test.js)

## Node 新建预设

7.1.4 起本项在新建 Node 后端配置中默认开启（类型检查仅限 node-typescript）。原有规则、阈值与配置字段不变；已有项目不因读取或升级而开启。实际工具、脚本和检查范围仍需接入准备，见 [Node 后端规范](node-backend.md)。

本项可关联应用的[目录职责与路径绑定](directory-roles.md)。新建预设的已绑定范围随目录引用解析，用户显式路径优先；原生工具配置须按接入规则单独核对。职责说明不代表业务语义已验证。
