# 结构化例外

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

在支持例外的规则中，记录经人工批准、限定位置和期限的临时处理。它不提供全局关闭全部检查的开关，也不改变官方执行顺序。

多应用仓库的例外分别放在各应用配置中，根公共入口不接受 `repository.exceptions`。`entries[].path` 相对于该应用目录，例如后端应用中的 `src/runtime.js`；同名路径不会放行前端文件。批准人、有效期、规则 ID 与位置约束仍需完整填写。根目录单应用继续使用相同的应用相对路径。

## 配置与审核

`repo-guard.config.json` 默认配置为：

```json
{
  "repository": {
    "exceptions": {
      "warningDays": 14,
      "maxDays": 90,
      "entries": []
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `repository.exceptions.warningDays` | 距到期多少天开始提醒，必须小于 maxDays | 整数<br>默认：`14` | ≥ 0；必须严格小于 maxDays。 |
| `repository.exceptions.maxDays` | 一条例外从创建到到期允许的最长天数 | 整数<br>默认：`90` | ≥ 1；≤ 365 |
| `repository.exceptions.entries` | 精确位置的人工批准例外列表，空数组表示没有例外 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `repository.exceptions.entries[].id` | 唯一的小写连字符例外标识 | 字符串<br>本对象内必填，无自动代填值 | 以小写字母开头，后续仅小写字母、数字、连字符 |
| `repository.exceptions.entries[].rule` | 具体规则 ID，例如 vue/no-v-html；不是点号分隔的 Gate ID | 字符串<br>本对象内必填，无自动代填值 | 匹配格式 `"^[a-z][a-z0-9-]*(/[a-z][a-z0-9-]*)+$"` |
| `repository.exceptions.entries[].path` | 唯一的仓库相对文件路径，禁止 glob 和父目录越界 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.exceptions.entries[].line` | 例外发生的源码行号，从 1 开始 | 整数<br>本对象内必填，无自动代填值 | ≥ 1 |
| `repository.exceptions.entries[].column` | 例外发生的源码列号，从 1 开始 | 整数<br>本对象内必填，无自动代填值 | ≥ 1 |
| `repository.exceptions.entries[].reason` | 具体技术与业务理由 | 字符串<br>本对象内必填，无自动代填值 | 至少 10 个字符 |
| `repository.exceptions.entries[].owner` | 负责修复并移除例外的人或团队 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.exceptions.entries[].approvedBy` | 独立人工批准者，不能与 owner 相同 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符；批准人必须与 owner 不同。 |
| `repository.exceptions.entries[].ticket` | 可供审阅的问题、审批或整改记录 | 字符串<br>本对象内必填，无自动代填值 | 至少 3 个字符 |
| `repository.exceptions.entries[].createdOn` | 真实创建日期，使用 YYYY-MM-DD | 字符串<br>本对象内必填，无自动代填值 | 有效的 YYYY-MM-DD 日期 |
| `repository.exceptions.entries[].expiresOn` | 真实到期日期；不得已过期，期限不得超过 maxDays | 字符串<br>本对象内必填，无自动代填值 | 有效的 YYYY-MM-DD 日期 |

<!-- config-fields:end -->

需要新增例外时，在 `entries` 中记录当前真实事实：

| 字段 | 要求 |
|---|---|
| `id` | 唯一的 kebab-case 标识 |
| `rule` | 报告中的规则 ID，形如 `namespace/rule`；不是带点号的 Gate ID |
| `path`、`line`、`column` | 单一仓库相对文件和正整数位置，不接受通配范围 |
| `reason` | 至少 10 个字符的具体原因 |
| `owner`、`approvedBy` | 真实责任人与批准人，两者不能相同 |
| `ticket` | 关联问题或审批记录 |
| `createdOn`、`expiresOn` | 真实的 `YYYY-MM-DD` 日期，期限不超过 `maxDays` |

不是每个 Gate 都接受例外；应先查对应规则的支持范围。不要把示意身份或日期直接当成真实审批。

```bash
npx repo-guard exceptions
```

## 执行与修复

CI `policy`、`full` 和 `release-ready` 有独立例外复核步骤，支持例外的具体规则会读取相应记录。过期例外会阻断相关配置加载和执行；删除已解决问题对应的例外，或完成真实重新评审后更新记录，再运行相同检查。普通注释不能替代结构化审批。

源码：[例外校验](../../src/config/exception-validation.js)、[期限检查](../../src/config/exception-lifecycle.js)。测试：[例外注册](../../test/policies/exception-registry.test.js)。
