# 源码安全规则

`checks.sourceSecurity` 为 Node 前端项目提供六组明确语法规则，默认开启。所有选项写入 `repo-guard.config.json`，允许项目手动修改；每组和每个检查项独立开关。Node 后端使用同一入口，默认只开启动态代码分类中的 eval 与 Function 检查；其余分类和字符串定时器默认关闭。Java 不启用这项能力。

接入项目无需已有目录、组件、变量或函数命名规范。手动命令收集 Git 已跟踪及未被 Git 忽略的未跟踪文件，再应用显式 `include` / `exclude`；不假设源码在 `src`，不自动排除测试、业务目录或名为 `dist` 的目录。构建产物等排除路径由项目明确配置。

```json
{
  "checks": {
    "sourceSecurity": {
      "enabled": true,
      "include": ["**/*.{vue,js,jsx,mjs,cjs,ts,tsx,mts,cts,html}"],
      "exclude": ["**/node_modules/**", "**/.git/**"],
      "dynamicCode": {
        "enabled": true,
        "eval": true,
        "functionConstructors": true,
        "stringTimers": true
      },
      "htmlInjection": {
        "enabled": true,
        "vueVHtml": true,
        "domHtmlWrites": true,
        "iframeSrcdoc": true,
        "allowEmptyClear": true
      },
      "inlineEventCode": {
        "enabled": true,
        "htmlEventAttributes": true,
        "domEventAttributeWrites": true,
        "stringEventPropertyWrites": true
      },
      "urlScheme": {
        "enabled": true,
        "navigation": true,
        "scriptSource": true
      },
      "newWindow": {
        "enabled": true,
        "requireNoopener": true,
        "requireNoreferrer": true,
        "forbidOpener": true,
        "checkWindowOpen": true
      },
      "crossWindowMessage": {
        "enabled": true,
        "requireExplicitTargetOrigin": true,
        "forbidWildcardTargetOrigin": true
      }
    }
  }
}
```

`requireNoreferrer` 保留原有前端门禁默认要求；它是可调整的团队约束，不将所有缺少该值的情况表述为已证实的浏览器漏洞。关闭检查或分类不卸载依赖，不删除配置。

## 支持的源码语法

| 分类 / 规则                                                      | 支持的检查                                                                                                                                                      | 明确边界                                                                                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动态代码 `security/no-eval`、`security/no-function-constructor`  | 全局 `eval` / `Function` 引用；`window`、`globalThis`、`self`、`global` 上直接书写的对应属性                                                                    | 使用作用域排除局部同名变量和 TS 类型引用；不追踪变量别名，也不执行字符串                                                                                                                          |
| 动态代码 `source-security/string-timer`                          | 全局及 `window`、`globalThis`、`self` 的 `setTimeout` / `setInterval`，首参数是字符串或无插值模板字面量                                                         | 直接函数表达式允许；变量处理器及展开参数无法确认                                                                                                                                                  |
| HTML 注入 `vue/no-v-html`                                        | Vue 模板中的 `v-html` 指令                                                                                                                                      | 无论输入来自哪个函数都执行禁用规则，不认定任何净化封装安全                                                                                                                                        |
| HTML 注入 `source-security/dom-html`                             | `document.write/writeln`；直接 `document.body/head/documentElement`（含 `window.document` 等全局限定形式）的 `innerHTML/outerHTML` 写入和 `insertAdjacentHTML`  | 不沿查询函数返回值、变量或 Vue ref 推导对象；普通对象同名属性仅记录身份未确认；直接 `= ""` 可允许，`+= ""` 不是清空                                                                               |
| HTML 注入 `source-security/srcdoc`                               | 原生 iframe 的 `srcdoc`，包括 Vue 字面量或动态绑定、JSX 属性                                                                                                    | 此规则禁止使用属性本身，不需要计算绑定值；脚本中的任意对象 `.srcdoc` 不推导                                                                                                                       |
| 内联事件 `source-security/inline-event`                          | 原生 HTML/Vue 的 `on*` 属性；上述明确 DOM 对象的 `setAttribute("on…", value)` 及字符串事件属性写入；JSX 字符串事件属性                                          | Vue `@click`、`addEventListener`、JSX 函数事件处理器允许；不将自定义组件名称解释为原生元素                                                                                                        |
| URL `source-security/url-scheme`                                 | `a/area/base.href`、`form.action`、`button/input.formaction`、`iframe/frame.src` 的字面量协议；`script.src`；直接 `document.location.assign/replace` 字面量参数 | 导航禁止 `javascript:`、`vbscript:`、`data:`；脚本地址禁止 `javascript:`、`data:`。HTML 实体和协议中 TAB/LF/CR 按源码解码；普通图片 data URL 不受此规则限制。不分析任意字符串、CSS URL 或动态地址 |
| 新窗口 `vue/target-blank-security`、`source-security/new-window` | 原生 `a/area/form` 显式 `_blank` 与同元素 `rel`；直接 `window.open` 的省略、空或 `_blank` 目标及字面量保护选项                                                  | 动态 target、rel、展开属性、展开参数无法确认；命名窗口不推导是否新建。普通自定义组件属性不套用该规则                                                                                              |
| 消息 `source-security/message-origin`                            | 直接 `window`、`window.parent/top/opener` 的 `postMessage`；位置参数或对象字面量 `targetOrigin`                                                                 | 缺少显式来源或字面量 `*` 违规；动态值、计算/展开选项无法确认；任意对象和 Worker/MessagePort 不套用 Window 规则                                                                                    |

脚本使用 Babel AST；Vue 单文件组件使用 `@vue/compiler-sfc`，Vue 模板使用 `@vue/compiler-dom`，HTML 使用 `parse5` 按 HTML 标准语法解析（允许合法省略闭合标签）。支持 JS、TS、JSX、TSX、Vue 普通 script / script setup，以及 HTML 中 JS/module 内联脚本。成员属性支持点号、字符串字面量和无插值模板字面量，可选链按相同语法处理；不计算 `"ev" + "al"` 等表达式。

不检查运行时替换全局 API、自定义包装调用、跨文件数据流、接口返回值、消息接收处理器是否安全、净化有效性、外部脚本内容或浏览器实际行为。Vue 模板表达式不会被当作完整脚本再次遍历；外部模板、非 HTML 模板、外部 SFC script 会标记无法确认。其他未支持的语法不在已验证范围内，不能据检查结果宣称没有漏洞。

## 唯一执行入口与报告

```sh
npx repo-guard source-security
npx repo-guard enable sourceSecurity
npx repo-guard disable sourceSecurity
```

所有阶段统一由 `source-security` 命令 / `security.source-security` 门禁执行六组规则。Hook 只读取传入的暂存文件；手动默认全项目；CI 默认全文件，可按 `ci.gatePolicy.gates["security.source-security"]` 配置可信变更范围和执行模式。不存在别名、旧命令转发、旧门禁分工或自动配置转换。

ESLint 的 `no-eval` 等工具规则继续独立存在，工具关闭不能隐式关闭这里的规则；不同工具报告不宣称跨工具去重。

明确违规返回统一 `violation`（退出码 2）；文件读取或语法解析失败返回 `execution-error`（退出码 1）。发现动态值或对象身份不明时仅记录中文“无法确认”诊断和 `metrics.unconfirmed`，不推导、不冒充违规；没有明确违规但存在无法确认项时返回 `skipped`，不作为交付通过证据。空文件范围同样返回 `skipped`。按公共契约，`skipped` 本身非阻断，不保证发布会因此阻断；需要交付证据的流程必须要求对应门禁实际通过。

规则例外复用 `repository.exceptions` 的路径、行列、规则和审批信息，不新增安全函数或组件名称白名单。通过表示已选范围的已支持源码规则未发现违规，不表示整项目或浏览器运行时安全。
