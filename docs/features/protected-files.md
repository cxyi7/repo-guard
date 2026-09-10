# 保护文件

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

单应用使用应用相对路径和 `level: "block"`。多应用在各子配置中维护各自的保护规则和排除项；根规则不继承到应用，也不检查应用源码，只保护应用目录外的公共文件。应用配置本身需要保护时，把配置文件名加入该应用的 `repository.rules`。

唯一应用使用 `root: "."` 时，公共入口仍可保护根配置、独立交付配置、运维配置、AGENTS、Git 辅助文件和托管流程目录；其他根目录文件由应用规则管理。前后端跨目录移动同时执行源目录删除和目标目录新增检查。

例如：

```json
{
  "repository": {
    "exclusions": [],
    "rules": [
      {
        "pattern": "src/security/permission-map.ts",
        "category": "不可变安全文件",
        "level": "block"
      }
    ]
  }
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `repository.rules` | 保护文件规则集合，按第一条匹配项决定级别 | 对象数组；对象字段见后续行<br>默认：内置 12 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项 |
| `repository.rules[].pattern` | 受保护文件的仓库相对 glob，* 匹配单层，** 可跨目录 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.rules[].category` | 报告与通知中显示的业务类别 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.rules[].level` | audit 仅记录；notify 在启用通知时要求发送成功；block 始终阻止修改、删除、重命名或移动匹配文件 | `"notify"` / `"audit"` / `"block"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `repository.exclusions` | 保护文件排除路径，优先于所有保护规则 | 字符串数组<br>默认：`[]` | 允许空数组；元素不可重复；每项为非空字符串 |

<!-- config-fields:end -->

修改、删除、重命名或移动该文件都会阻断提交和 CI。规则按数组顺序采用第一条匹配，精确 `block` 规则应放在可能覆盖它的宽泛规则之前；`exclusions` 优先于规则。

`audit`、`notify`、`block` 分别用于审计、通知和阻断级别；CI 的保护文件动作另受 `ci.protectedFiles.action` 约束，但 `block` 仍必须阻断。下列命令只针对保护文件及其相关检查，不代表运行全部测试：

```bash
npx repo-guard check
npx repo-guard gate
npx repo-guard dry-run
npx repo-guard gate --force-notify
```

`check` 查看工作区受保护变更，发现此类变更就会返回非零；`gate` 执行提交侧保护流程；`dry-run` 预览保护文件判断，不发送通知。

## 执行边界与修复

保护文件是 pre-commit 最后一个独立模块，前置格式或源码检查失败时不会靠通知来放行。它与暂存代码质量模块保持分离。`rules` 使用路径、类别和级别，不属于功能启停开关。

`audit` 记录匹配事实，`notify` 按本地通知配置处理，`block` 始终阻断；关闭通知不等于解除 `block`。CI 不读取本地通知密钥，动作由 CI 策略和保护级别共同决定。

发现非预期保护文件改动时先定位修改来源，只撤回不需要的那部分改动。确需变更团队保护策略时应单独评审规则及影响，再复核真实变更。不要把 `check` 的非零状态误认为全部测试失败，也不要把通知发送成功误认为业务验收通过。

## 维护依据

[实现入口](../../src/gates/repository/repository-policy-gates.js) · [对应测试](../../test/gates/repository/protected-files-gate.test.js)
