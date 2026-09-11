# 文件归位

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

按文件类型规定允许目录，避免图片、文档和其他资源散落在任意位置。文件目录由本能力治理，指定代码文本的出现位置则由[代码位置](code-placement.md)治理。

本项只管理当前应用，配置路径相对应用根目录。需要限制“整个仓库的 SQL 只能放在某处”，包括未登记的公共目录，请在根配置使用[仓库级文件归位](repository-file-placement.md)。两者独立执行，应用例外不能豁免根规则。

Java 应用也可独立开启本项，例如要求 `*Test.java` 位于 `src/test/java/**`、`*Service.java` 位于团队指定目录。Java 预设默认关闭；多模块需显式包含各模块或使用相应通配路径。反向要求“某目录所有文件都必须以 Service.java 结尾”由 [Java 文件与目录命名](java-path-naming.md)检查；文件归位只限制匹配文件的允许位置。完整组合示例见 [Java 接入说明](../java-quality-integration.md#目录命名与保护文件)。

## 配置与运行

默认启用，`newFiles` 模式主要约束新增文件，也处理复制和重命名后的文件；`changedFiles` 覆盖所选范围内的非删除变更。显式审计入口为：

```bash
npx repo-guard file-placement
```

配置片段：

```json
{
  "checks": {
    "filePlacement": {
      "enabled": true,
      "mode": "newFiles",
      "rules": [
        {
          "name": "图片资源",
          "patterns": [
            "**/*.{png,jpg,svg}"
          ],
          "allowedPatterns": [
            "src/assets/**",
            "docs/assets/**"
          ],
          "exceptions": [
            "public/favicon.svg"
          ],
          "suggestedDirectory": "src/assets"
        }
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.filePlacement.enabled` | 是否启用自动文件归位检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.filePlacement.mode` | newFiles 检查新增、复制和重命名路径；changedFiles 检查所有非删除变更 | `"newFiles"` / `"changedFiles"`<br>默认：`"newFiles"` | 只接受列出的值 |
| `checks.filePlacement.rules` | 按顺序匹配的文件分类规则，第一条匹配的规则生效 | 对象数组；对象字段见后续行<br>默认：内置 2 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项 |
| `checks.filePlacement.rules[].name` | 报告中显示的文件类别名称 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.filePlacement.rules[].patterns` | 选择该规则治理的文件类型，匹配不区分大小写 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串 |
| `checks.filePlacement.rules[].allowedPatterns` | 匹配文件允许存放的应用相对位置 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串 |
| `checks.filePlacement.rules[].exceptions` | 该条规则内允许放行的特殊文件路径 | 字符串数组<br>默认：`[]` | 允许空数组；每项为非空字符串 |
| `checks.filePlacement.rules[].suggestedDirectory` | 归位失败时建议移动到的具体目录，不会自动移动文件 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |

<!-- config-fields:end -->

数组替换整套归位规则；需要字体、媒体、Markdown 等约束时应同时保留。默认资源位置包括 `src/assets`、`public/assets`、`docs/assets`，Markdown 使用文档等约定目录并允许根 README 等文件。

## 判断与处理

规则按顺序取第一条类型匹配项，再检查该项的例外与允许路径；`suggestedDirectory` 用于修复提示，不会自动移动文件。删除不产生目标归位要求。

pre-commit 检查暂存变更，CI 三档按可信变更范围复核，手动命令用于工作区全量审计。违规时移动文件并更新源码、样式和文档引用，重新暂存后复核。没有匹配规则的文件不受该规则集约束；路径规范化与大小写匹配应以门禁报告为准。

## 维护依据

[实现入口](../../src/policies/file-placement.js) · [对应测试](../../test/policies/file-placement.test.js)
