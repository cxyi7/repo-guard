# 代码位置

限制指定精确代码文本出现的位置，避免实现散落到未允许的文件。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`；`migrate` 仅用于旧版本显式迁移。

`codePlacement` 使用精确文本匹配。pre-commit 检查格式化完成后的最终 Git 索引，未暂存内容不会误阻断本次提交。

```json
{
  "repository": {
    "codePlacement": {
      "enabled": true,
      "rules": [
        {
          "name": "支付签名实现",
          "content": "const signature = createPaymentSignature(payload);",
          "allowedFiles": [
            "src/payment/signature.ts",
            "src/admin/payment-signature.ts"
          ],
          "scanPatterns": [
            "src/**/*.{js,jsx,ts,tsx,vue}"
          ]
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
| `repository.codePlacement.enabled` | 是否在 pre-commit 和 CI policy 中强制执行代码位置策略 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.codePlacement.rules` | 本能力的有序规则集合，各项字段见后续行 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `repository.codePlacement.rules[].name` | 用于中文问题说明和修复指引的规则名称 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.codePlacement.rules[].content` | 需要限制位置的精确代码文本；检查时只统一 CRLF/CR 换行 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.codePlacement.rules[].allowedFiles` | 允许出现该代码的一个或多个仓库相对文件 glob | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串 |
| `repository.codePlacement.rules[].scanPatterns` | 需要搜索该代码的仓库相对文件 glob | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串 |

<!-- config-fields:end -->

匹配时只统一 CRLF/CR 为 LF，不忽略其他空白，也不把语义相近但文本不同的代码视为相同。

## 执行与复核

执行入口：手动、pre-commit、CI policy/full 和 release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/policies/code-placement.js) · [对应测试](../../test/gates/repository/code-placement.test.js)
