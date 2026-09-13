# Stylelint 与统一样式检查

Token 子能力可进一步配置[指定值与生成 CSS 校验](ui-token-values.md)，所有选项仍保存在 `checks.stylelint.uiTokens`。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

样式配置统一保存在 `checks.stylelint`：原生规则使用 `options`，隔离与全局目录使用 `governance`，设计变量使用 `uiTokens`。新前端初始化及显式启用写入默认规则和已开启的治理；读取既有稀疏配置不暗中开启。Token 主开关在新前端配置中默认开启；必须先完成设计规范、清单和来源文件配置，缺项不能算检查通过。

## 配置与优先级

以下为重点字段片段，完整规则见[前端工具预设](frontend-tool-presets.md)。用户可修改已写入的值，重复启用保留修改；关闭主开关不会删除配置、卸载依赖或清除子开关。

```json
{
  "checks": {
    "stylelint": {
      "enabled": true,
      "pattern": "**/*.{css,scss,sass,less,vue}",
      "fix": true,
      "maxWarnings": 0,
      "requireConfig": true,
      "options": {
        "rules": {
          "selector-max-compound-selectors": 3,
          "max-nesting-depth": 3,
          "selector-max-id": 0,
          "declaration-no-important": true,
          "selector-max-specificity": null,
          "custom-property-no-missing-var-function": true,
          "declaration-block-no-duplicate-custom-properties": true,
          "no-descending-specificity": null
        },
        "overrides": [
          {
            "files": ["**/*.css"],
            "rules": { "selector-max-specificity": "0,3,1" }
          },
          { "files": ["**/*.vue"], "customSyntax": "postcss-html" }
        ]
      },
      "governance": {
        "enabled": true,
        "allowedGlobalStylePatterns": ["styles/**"]
      },
      "uiTokens": { "enabled": true }
    }
  }
}
```

| 字段            | 含义与默认值                                                   |
| --------------- | -------------------------------------------------------------- |
| `enabled`       | 主开关；读取补缺为 false，新前端初始化为 true                  |
| `pattern`       | 普通检查范围，默认上述全部样式后缀                             |
| `fix`           | Hook 修复可修复项，默认 true；手动命令及 CI 只读               |
| `maxWarnings`   | 警告上限，默认 0                                               |
| `requireConfig` | 默认 true；内联 options 或原生配置均可满足                     |
| `options`       | 原生规则、共享配置、插件和语法 overrides                       |
| `governance`    | 仅隔离和全局目录，见[样式治理](style-governance.md)            |
| `uiTokens`      | 语言、清单、扫描范围，见[Token 检查](ui-tokens.md) |

两层配置逐文件解析合并，用户原生同名规则、关闭值和语法设置优先。复杂度、权重、ID 和 important 只执行最终原生规则。治理和 Token 的开关、路径及例外在 repo-guard 配置修改；原生规则不覆盖 Token 清单事实。

消费项目提供 Stylelint、规则包及语法包。Vue 治理使用消费项目 Vue 3.5 编译器解析 SFC，样式还需 postcss-html；预处理语言按实际需要补充语法与规则。使用 `repo-guard tool-config --tool stylelint --file src/App.vue` 检查合并结果。接入 Skill 尚未实现，见[待办](skill-integration-backlog.md)。

## 执行与边界

```bash
npx repo-guard enable stylelint
npx repo-guard doctor
npx repo-guard stylelint
```

手动入口统一运行普通规则、治理和已启用的 Token，保留各项发现并按公共错误优先级汇总。多应用加 `--project <id>`。无适用文件或全部被忽略时返回跳过，不作为通过证据。

Hook 顺序保持 Stylelint 修复、ESLint 修复、Prettier、Stylelint/ESLint 只读复核、保护文件检查；保留未暂存修改。Token 内部只读步骤仍保留：清单、定义源或相关配置变化时复查全量样式，不能仅检查暂存样式。CI full/release-ready 执行普通样式检查，Token 另支持 policy。

配置或语法无法解析属于配置错误，工具启动和超时属于执行错误，规则发现属于违规。修复失败恢复本次文件修改，不通过放宽阈值或扩大例外掩盖失败。

4.0 移除了旧顶层 `checks.styleComplexity`、`checks.styleGovernance`、`checks.uiTokens` 及其独立启用名和执行命令。旧字段明确拒绝，不自动转换，须按当前结构人工审阅调整。

当前普通 Stylelint 门禁仍要求每个 Vue 文件只使用一种 style 语言；混用会返回配置错误，不能视为已支持。

新建预设开启主开关不代表已建立设计规范。values.enabled 与 artifacts.enabled 仍默认关闭，需显式配置指定值和生成 CSS 范围后开启；不得自动填入业务设计值或伪造 Token 清单。通用字段回退值不改变既有配置。

本项可关联应用的[目录职责与路径绑定](directory-roles.md)。新建预设的已绑定范围随目录引用解析，用户显式路径优先；原生工具配置须按接入规则单独核对。职责说明不代表业务语义已验证。
