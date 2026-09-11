# 仓库级文件归位

[返回使用说明](../usage-guide.md) · [功能索引](README.md) · [应用内文件归位](file-placement.md)

规定整个 Git 仓库中某类文件只能存放在指定目录。例如，SQL 只能放在 `database/sql/`，放到前端、Java 后端或未登记的公共目录都会被检查。此能力只检查文件路径，不解析 SQL 语法或业务内容，也不自动移动文件。

## 配置与运行

在 Git 根目录的 `repo-guard.config.json` 合并以下片段。单应用与多应用均可使用；多应用的子配置不允许声明 `repository.filePlacement`。

```json
{
  "repository": {
    "filePlacement": {
      "enabled": true,
      "rules": [
        {
          "name": "SQL 文件集中存放",
          "patterns": ["**/*.sql"],
          "allowedPatterns": ["database/sql/**"],
          "exceptions": [],
          "suggestedDirectory": "database/sql"
        },
        {
          "name": "运行环境配置集中存放",
          "patterns": ["**/application*.{yml,yaml,properties}"],
          "allowedPatterns": ["services/api/src/main/resources/**"],
          "exceptions": [],
          "suggestedDirectory": "services/api/src/main/resources"
        }
      ]
    }
  }
}
```

第二条只选择 `application` 开头的指定格式文件，不会把所有 YAML 文件都当成后端配置。按团队实际目录修改；数组整体替换，增加规则时需保留原有要求。

<!-- config-fields:start -->
| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `repository.filePlacement.enabled` | 是否开启全仓路径检查 | `true` / `false`；默认 `false` | 只接受布尔值；开启时必须准备至少一条规则 |
| `repository.filePlacement.rules` | 按文件类型限制允许位置 | 对象数组；默认 `[]` | 从上到下采用第一条匹配规则；开启时不能为空 |
| `repository.filePlacement.rules[].name` | 报告中显示的规则名称 | 非空字符串，必填 | 建议使用可读的中文类别名 |
| `repository.filePlacement.rules[].patterns` | 选中受约束的文件 | 非空 glob 字符串数组，必填 | 相对仓库根目录，匹配不区分大小写，包含隐藏路径；`**/*.sql` 也覆盖根目录 SQL 和 `.SQL` |
| `repository.filePlacement.rules[].allowedPatterns` | 允许存放的位置 | 非空 glob 字符串数组，必填 | 相对仓库根目录，区分大小写；使用 `/`，不能使用绝对路径或 `..` 越界 |
| `repository.filePlacement.rules[].exceptions` | 根规则中明确允许的特殊路径 | glob 字符串数组；默认 `[]` | 区分大小写；严格只允许指定目录时保持空数组。应用例外不能替代此字段 |
| `repository.filePlacement.rules[].suggestedDirectory` | 违规提示中建议移入的目录 | 非空仓库相对路径，必填 | 必须是具体目录，不接受 glob、绝对路径或 `..`；仅提供建议，不创建目录或移动文件 |
<!-- config-fields:end -->

不支持 `mode`、未知字段或 `null`。没有任何规则匹配的文件不受此能力约束；如果多条规则的 `patterns` 重叠，第一条生效，应把具体规则放在宽泛规则前面。

```bash
# 手动审计整个仓库，可从仓库内任意目录运行
npx repo-guard repository-file-placement

# 规则已配置后启用或关闭；会同步根团队规范
npx repo-guard enable repositoryFilePlacement
npx repo-guard disable repositoryFilePlacement

# 手工编辑配置后同步托管资料，再检查工具和规则是否就绪
npx repo-guard doctor --fix
npx repo-guard doctor
```

仓库级命令无需 `--project`。即使传入有效的应用标识，也仍检查整个仓库；无效标识会报错。Java 仓库可以直接使用已安装的全局 `repo-guard` 命令，执行此项只需要 Git，不需要 Maven、JDK 或 Java 插件。

如果多应用清单将唯一应用配置为 `root: "."`，根规范与应用规范写入同一份 `AGENTS.md`。初始化、启停、Doctor 修复与 CI 使用一致的规范上下文；根归位规则不会因此写入应用配置或重复执行。

## 什么时候检查

| 入口 | 检查依据 | 能发现什么 |
|---|---|---|
| 手动命令 | 工作区中仍存在的受控文件和未被 Git 忽略的未跟踪文件 | 尚未暂存的错位文件；关闭时明确跳过 |
| pre-commit | **完整 Git 索引** | 本次新增、移动及历史上已跟踪但未修改的错位文件；仅在工作区删除仍会被拦截，暂存删除后才移出范围 |
| pre-push | 待推送提交的完整文件树 | 只修改公共说明也不能遗漏仓库中已有的错位文件；沿用统一推送快照校验 |
| CI policy / full / release-ready | 可信 `revision.head` 的完整文件树 | 不受应用筛选、变更文件范围或本地未提交移动影响；根门禁只执行一次 |

CI 使用 Gate `repository.global-file-placement`，遵循统一的 `ci.gatePolicy`。需要强制阻断时使用 `inherit` 配合已启用功能，或显式 `enforce`；`report` 保留违规证据但不阻断，`off` 跳过。强制执行但没有规则属于配置错误，不能变成通过。

仓库范围以 Git 管理边界为准：子模块入口不当普通文件检查，也不进入子模块内部，报告会列明排除数量。独立 Git 仓库需各自配置；未跟踪且被忽略的本地文件不属于审计范围。已经被跟踪的文件即使后来加入 `.gitignore`，仍参与检查。

`git add -N` 只登记新增意向，文件尚未进入实际待提交树，因此提交检查不会把它误当作已暂存文件；手动工作区审计仍会检查实际存在的文件。真正暂存的空文件不会被排除。

## 与应用规则如何协作

`repository.filePlacement` 的路径相对仓库根目录，由根配置执行一次；`checks.filePlacement` 的路径相对应用目录，由对应应用执行。两套规则独立生效，文件必须满足两边要求，关闭应用规则或添加应用例外不会覆盖根规则。

例如根规则要求 SQL 只能在 `services/api/src/main/resources/db/**`，Java 应用还可要求自己的 SQL 只在 `src/main/resources/db/migration/**`。公共目录无须登记成应用，也无须加入 `sharedPaths` 才能被根规则覆盖。

## 报告与修复

违规报告提供仓库相对路径、命中的规则、允许位置、建议位置及修复步骤。移动文件后同步更新引用并重新暂存；无需为了检查范围而修改前端或后端的技术栈配置。

结果复用统一 `GateResult` 和退出码：通过或非阻断为 `0`，配置/执行错误为 `1`，违规为 `2`，不可信 Git 范围为 `3`。报告清楚区分扫描文件数、匹配数、违规数与未进入的子模块数量；配置关闭、CI 跳过不能作为交付通过证据。

## 维护依据

[根配置校验](../../src/config/repository-file-placement.js) · [Git 路径事实](../../src/git/repository-file-paths.js) · [独立门禁](../../src/gates/repository/global-file-placement-gate.js) · [配置测试](../../test/config/repository-file-placement.test.js) · [路径测试](../../test/core/repository-file-paths.test.js) · [门禁测试](../../test/gates/repository/global-file-placement.test.js) · [真实命令与 Hook 测试](../../test/hooks/repository-file-placement.test.js)
