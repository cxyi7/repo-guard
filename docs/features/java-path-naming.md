# Java 文件与目录命名

`javaPathNaming` 独立检查 Java 文件名和目录名，命令为 `repo-guard java-path-naming`，门禁标识为 `java.path-naming`。默认关闭；启用后可用于手动检查、`pre-commit`、`pre-push`、`ci-policy`、`ci-full` 和 `release-ready`。本轮支持 Java Maven 项目。

检查读取当前应用的完整 Git index 路径，即使本次变更列表为空，也会检查范围内已暂存和此前已跟踪的路径。暂存删除的路径不再参与；未跟踪文件不参与。未暂存的文件重命名不会改变 index 中被检查的名称。门禁不需要 JDK，不读取 Java 语法，不修改或重命名文件，也不调整暂存区。

## 默认行为

默认检查所有模块的 `src/main/java/` 与 `src/test/java/`。Java 文件名去掉最后一个扩展名后须满足 `PascalCase`；包目录须满足 `lowercase`。模块名前缀、其他技术栈的目录和源码根之外的文件不受默认规则约束。

`package-info.java`、`module-info.java` 是每项文件规则的默认例外。它们的父目录仍参与目录命名检查，例如 `src/main/java/BadPackage/package-info.java` 仍会报告 `BadPackage`。目录来自 Git index 文件的全部父目录，重复目录只检查一次；Git 不跟踪空目录，因此空目录没有检查证据。门禁不遍历子模块仓库的内部路径。

命名和路径匹配始终区分大小写，并使用 Git 记录的实际名称，Windows 上也不会放宽名称要求。此门禁不判断 Java 声明的类名是否与文件名一致，也不校验 `package` 声明是否匹配目录；这些由 Java 语义规则和编译检查承担。

## 配置字段

以下所有路径均相对当前应用目录，不相对工作区根目录。`include`、`exclude` 匹配完整相对路径；`basename` 仅匹配最后一个名称，文件包含扩展名。数组显式配置时替换默认数组。

| 字段                  | 含义与可填值                                                | 默认值与约束                                                                                                                        |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`             | 是否启用检查，布尔值                                        | `false`                                                                                                                             |
| `include`             | 整个检查的路径范围                                          | `["**/src/main/java/**", "**/src/test/java/**"]`；1 至 64 项                                                                        |
| `exclude`             | 从整个检查中排除的文件或目录路径                            | `[]`；最多 64 项；排除目录树需写成 `路径/**`                                                                                        |
| `rules`               | 文件、目录及团队命名规则                                    | 默认两项规则见下方示例；1 至 64 项；显式配置替换全部默认规则                                                                        |
| `rules[].id`          | 问题报告中使用的稳定规则标识                                | 必填且不得重复；小写字母开头，只含小写字母、数字和连字符，1 至 64 字符                                                              |
| `rules[].target`      | 规则检查文件还是目录                                        | 必填，`files` 或 `directories`                                                                                                      |
| `rules[].include`     | 本项规则适用的完整相对路径                                  | 必填，1 至 64 项；需同时满足全局 `include`                                                                                          |
| `rules[].exclude`     | 只在本项规则内排除的路径                                    | `files` 默认 `["**/package-info.java", "**/module-info.java"]`，`directories` 默认 `[]`；最多 64 项；显式 `[]` 会取消默认描述符例外 |
| `rules[].conventions` | 对名称施加的固定命名约定                                    | 默认 `[]`；可填下表约定，不得重复；所有列出的约定同时适用                                                                           |
| `rules[].basename`    | 完整文件名或目录名允许匹配的通配符，例如 `*Controller.java` | 默认 `[]`；最多 64 项，候选之间为“或”；不得含 `/` 或 `**`                                                                           |

每项规则的 `conventions` 与 `basename` 至少一个非空。所有匹配规则共同生效，不会因为一条后缀规则匹配成功就跳过 `PascalCase`。同一规则的约定与名称通配符也必须同时满足。`exclude` 只取消其所属范围的规则，不会取消其他匹配规则。关闭检查时仍严格校验字段，显式 `null` 不作为缺省值。

| 命名约定     | 精确定义                                                  | 示例                           |
| ------------ | --------------------------------------------------------- | ------------------------------ |
| `PascalCase` | 大写英文字母开头，其余为英文字母或数字；允许大写缩写      | `UserController`、`XMLReader2` |
| `camelCase`  | 小写英文字母开头，其余为英文字母或数字                    | `userController`               |
| `lowercase`  | 小写英文字母开头，其余为小写字母或数字                    | `controller`、`api2`           |
| `kebab-case` | 小写英文字母开头，后续小写字母、数字分组可以单个 `-` 连接 | `api-client`                   |
| `snake_case` | 小写英文字母开头，后续小写字母、数字分组可以单个 `_` 连接 | `api_client`                   |

约定只使用固定 ASCII 规则。对文件去掉最后一个扩展名后检查，对目录使用完整名称；例如 `User.test.java` 的受检名称是 `User.test`，不符合 `PascalCase`。目录名即使包含点也不会被当作扩展名截断。

简单通配符只支持普通字符、`*`（同一名称内任意多个字符）、`?`（同一名称内一个字符）、独立路径段 `**`（零层或多层目录）。每项长度为 1 至 256 字符，数组内不得重复，不允许首尾空白、反斜杠、绝对路径、空路径段、`.` 或 `..` 路径段，也不支持正则表达式、字符组、花括号展开、否定或扩展通配符。路径统一使用 `/`。匹配使用动态规划，不把用户配置转换成正则表达式。

## 同时约束 PascalCase 和团队后缀

以下完整配置保留默认文件、包目录规则，并要求 `controller` 目录树中的 Java 文件以 `Controller.java` 结尾，`service` 目录树中的文件以 `Service.java` 结尾。`user.java` 位于 `controller` 内时会同时报告 PascalCase 与后缀问题。

```json
{
  "version": 2,
  "project": {
    "id": "java-api",
    "role": "backend",
    "stack": "java",
    "preset": "java-maven"
  },
  "checks": {
    "javaPathNaming": {
      "enabled": true,
      "include": ["**/src/main/java/**", "**/src/test/java/**"],
      "exclude": [],
      "rules": [
        {
          "id": "java-files",
          "target": "files",
          "include": ["**/*.java"],
          "exclude": ["**/package-info.java", "**/module-info.java"],
          "conventions": ["PascalCase"],
          "basename": []
        },
        {
          "id": "java-packages",
          "target": "directories",
          "include": ["**"],
          "exclude": [],
          "conventions": ["lowercase"],
          "basename": []
        },
        {
          "id": "controller-suffix",
          "target": "files",
          "include": ["**/controller/**/*.java"],
          "exclude": ["**/package-info.java", "**/module-info.java"],
          "conventions": [],
          "basename": ["*Controller.java"]
        },
        {
          "id": "service-suffix",
          "target": "files",
          "include": ["**/service/**/*.java"],
          "exclude": ["**/package-info.java", "**/module-info.java"],
          "conventions": [],
          "basename": ["*Service.java"]
        }
      ]
    }
  }
}
```

如果团队允许服务接口和实现使用不同后缀，可将同一规则的 `basename` 配置为 `["*Service.java", "*ServiceImpl.java"]`。若只约束直接位于某目录的文件，使用 `**/controller/*.java`；包含其子目录时使用示例中的 `**/controller/**/*.java`。

## 结果与相关门禁

命名违规使用公共违规状态和退出码；配置错误或无法读取 Git index 使用公共配置、执行错误，不把空读取结果当作成功。门禁关闭时为跳过。当前仅声明 `all-files` 范围，不能把部分变更检查当作完整命名检查。

本门禁负责名称；`javaFiles` 和 `filePlacement` 负责文件位置或禁止产物，文件保护负责禁止未授权变更，`javaNaming` 负责 Java 语义中的标识符命名。它们独立配置和报告。团队目录后缀规则由项目明确配置，不内置业务分层或业务类职责。
