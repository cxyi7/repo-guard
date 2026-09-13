# 目录职责与路径绑定

在所属应用的 repo-guard.config.json 中维护 directories。职责标识稳定，路径和用途可以手动修改；规范用于指导文件放置，不证明代码实现符合业务职责。不会自动创建或移动目录，也不会根据类名猜测代码用途。

## 配置

以下片段合入所属应用配置。已有项目没有 directories 时保持原行为，不猜测或覆盖原目录。新建 Java、Node 和前端配置分别写入目录模板。

```json
{
  "directories": {
    "entries": {
      "source": { "path": "src", "purpose": "项目源码。" },
      "utils": { "path": "${source}/utils", "purpose": "公共方法。" },
      "tests": { "path": "${source}/tests", "purpose": "测试代码。" }
    },
    "bindings": {
      "checks.unitTest.sourcePatterns": {
        "format": "glob",
        "value": ["${utils}/**/*.{js,ts}"]
      },
      "checks.unitTest.mappings": {
        "format": "glob",
        "value": [{
          "sourcePattern": "${utils}/**/*.{js,ts}",
          "sourceRoot": "${utils}",
          "testTemplates": ["${tests}/{relativePath}.test.{ext}"]
        }]
      },
      "checks.architecture.sourcePaths": {
        "format": "path", "value": ["${source}"]
      }
    }
  }
}
```

将 utils.path 改为 shared/helpers 后，绑定的测试范围与映射使用新路径。将 source.path 改为 server 后，仍引用 source 的子目录一起改变；写死的独立目录保持不变。测试模板的 `{relativePath}`、`{ext}` 与目录引用 `${utils}` 属于不同语法，互不替代。

## 字段与优先级

| 字段 | 用途与限制 |
|---|---|
| `directories.entries` | 职责登记，最多 64 项；标识以小写字母开头，只含字母、数字和连字符 |
| `directories.entries.<职责>.path` | 应用根目录下的字面相对路径；支持 `${其他职责}`，禁止循环、未知职责、绝对路径、越界和 glob |
| `directories.entries.<职责>.purpose` | 单行用途说明，最多 1000 字符；供 AI 和开发者遵循，不参与业务语义判断 |
| `directories.bindings` | 最多 128 个显式字段绑定；字段清单由 Schema 枚举，不能绑定主开关等任意属性 |
| `directories.bindings.<字段>.format` | path 为路径、glob 为文件模式、regex 为正则；regex 会转义目录值中的点号 |
| `directories.bindings.<字段>.value` | 对应字段的模板，支持嵌套 JSON；解析后仍执行原检查的字段校验 |

目录路径支持字母、数字、中文、空格、下划线、点、连字符及 `/`，不接受通配符和 shell 特殊字符。路径只做配置约束；具体文件存在性与符号链接边界继续由各检查负责，不把目录登记当成文件已存在的证据。

优先级为：用户在 checks 中显式填写的独立路径优先；字段省略时采用 bindings 的模板。用户显式值中使用 `${职责}` 时按该字段绑定的 format 展开。移除绑定后可完全独立配置；引用目录却没有声明绑定格式会报错。原生 ESLint、Stylelint、Knip、Stryker 等配置仍遵循既有用户配置优先规则。

写回时省略与绑定一致的派生字段，保留用户独立值；Schema 必填的 mutationTest.options.mutate 和 Java modules 保留引用模板，不留下旧的展开路径。重复启用不会把已绑定路径恢复成旧预设。内存中的规范化配置是执行结果，编辑目录前先通过 serializeProjectConfig 获取可保存配置，再重新加载；不要直接修改已经解析的检查结果。

## 初始目录约定

| 项目 | 默认职责 |
|---|---|
| Java | source、tests、resources、testResources、packages、controller、service、repository、dto、config、utils、output、docs |
| Node 后端 | source、tests、utils、types、config、controller、service、repository、middleware、output、coverage、reports、docs |
| 前端 | source、tests、utilityTests、utils、types、styles、assets、public、components、pages、views、composables、api、stores、store、features、shared、constants 等 |

Java source 默认 src/main/java，tests 默认 src/test/java。packages 默认引用 source；有组织包前缀时可改为 `${source}/com/example/app`，controller、service 等目录随之改变。源码根与业务包根分别声明，不用猜测项目包名。Maven 多模块匹配仍保留原规则中的模块前缀通配符；非标准模块目录可分别登记职责并自定义绑定。

Node 默认 tests 为 test，并将源码映射到该目录的相对测试路径。前端 tests 默认 src/tests，utilityTests 默认 `${tests}/utils`，允许独立修改。前端公共方法、composables、接口和状态文件的规模分类采用登记目录；嵌套业务模块中同名目录不会被自动认定为同一种职责，可通过显式规则增加范围。

## 前端与 Node 的通用模板

前端的 JavaScript/TypeScript 预设共用一套目录职责，Node 后端的两种语言预设共用另一套。默认路径不是必须存在的文件夹清单；没有对应内容时不要求创建空目录，路径与用途均可修改。JavaScript 项目的 types 可用于声明文件。前端 pages/views、store/stores 是可选组织方式，不要求同时建立；删除不使用的职责前须同步移除引用该职责的绑定。当前前端执行预设支持 Vue，目录职责本身不验证框架或业务语义。

### 前端通用目录

| 职责标识 | 默认路径 | 用途 |
|---|---|---|
| `source` | `src` | 应用源码。 |
| `tests` | `src/tests` | 测试代码和测试夹具。 |
| `utils` | `src/utils` | 公共方法。 |
| `types` | `src/types` | 共享类型声明。 |
| `config` | `src/config` | 应用配置与装配。 |
| `output` | `dist` | 构建产物。 |
| `coverage` | `coverage` | 覆盖率报告。 |
| `reports` | `reports` | 其他检查报告。 |
| `docs` | `docs` | 项目说明与维护文档。 |
| `utilityTests` | `src/tests/utils` | 公共方法对应的测试。 |
| `styles` | `styles` | 共享样式与设计变量。 |
| `assets` | `src/assets` | 源码引用的静态资源。 |
| `public` | `public` | 直接发布的公共资源。 |
| `components` | `src/components` | 可复用界面组件。 |
| `pages` | `src/pages` | 路由页面。 |
| `views` | `src/views` | 页面视图。 |
| `composables` | `src/composables` | 可复用组合逻辑。 |
| `api` | `src/api` | 接口调用。 |
| `stores` | `src/stores` | 共享应用状态。 |
| `store` | `src/store` | 单目录状态模块。 |
| `features` | `src/features` | 按业务组织的模块。 |
| `shared` | `src/shared` | 跨业务共享实现。 |
| `constants` | `src/constants` | 共享常量。 |

### Node 后端通用目录

| 职责标识 | 默认路径 | 用途 |
|---|---|---|
| `source` | `src` | 应用源码。 |
| `tests` | `test` | 测试代码和测试夹具。 |
| `utils` | `src/utils` | 公共方法。 |
| `types` | `src/types` | 共享类型声明。 |
| `config` | `src/config` | 应用配置与装配。 |
| `output` | `dist` | 构建产物。 |
| `coverage` | `coverage` | 覆盖率报告。 |
| `reports` | `reports` | 其他检查报告。 |
| `docs` | `docs` | 项目说明与维护文档。 |
| `controller` | `src/controllers` | 请求入口、协议参数与响应处理。 |
| `service` | `src/services` | 业务流程与服务实现。 |
| `repository` | `src/repositories` | 数据访问。 |
| `middleware` | `src/middleware` | 请求处理公共中间件。 |

## 联动范围与边界

| 检查领域 | 可绑定路径 |
|---|---|
| 测试、覆盖率、变异 | 源码范围、测试范围、源文件到测试映射、排除项、报告目录、Stryker mutate；覆盖率沿用单元测试范围 |
| 文件规范 | 文件归位、命名、行数规则、函数文档、文件头、源码安全和异步清理范围 |
| 架构 | sourcePaths、tsConfig、排除正则、依赖规则中的路径正则；目录按字面值转义 |
| 样式与资源 | 共享样式目录、Token 范围与定义文件、图片范围、静态引用根、资源别名 |
| 工具与构建 | 已登记的 Knip 入口/范围、类型配置文件、构建产物目录、报告文件等；具体支持字段见 Schema |
| Java | 八项源码检查范围、允许源码根、目录命名范围、模块报告和产物路径、pom 路径 |

新建模板绑定已有预设中可明确关联的路径，不自动填充缺失的 Knip 入口、业务页面、Java 测试类、产物名称或插件版本。检查里没有目录依赖的规则保持不变。需要扩展绑定时使用 Schema 列出的字段；不支持对整个配置递归猜测目录含义。

目录配置不重写 tsconfig、Maven POM、Vite、Vitest、Knip、Stryker 等原生文件。改变源码、测试或产物目录后，人或后续 Skill 必须同步原生工具配置并真实执行检查；只修改 repo-guard 的查找范围不等于工具已经按新目录生成产物。Java 默认全开模板的接入缺项继续阻断执行。

多应用各自登记 directories，路径相对所属应用。仓库公共配置不能替子应用登记目录。目录变更随应用配置进入暂存快照及 CI 检查，既有配置变更复查机制保持；同步 AI 规范后会列出解析后的路径、用途及职责边界。

## 验证

使用 repo-guard doctor 同步检查接入缺项；需要写回 AI 规范时执行 repo-guard doctor --fix。随后真实执行受影响的检查。目录声明本身不证明某文件是公共方法、控制器或数据访问实现，业务判断仍由测试和人工审查承担。

[配置测试](../../test/config/directory-roles.test.js) · [真实消费配置联调](../../test/integrations/directory-roles.test.js)

## 配置 API 写回约定

通过程序新建文件时使用 serializeProjectConfig(createProjectDocument(descriptor)) 再写入 JSON。createProjectDocument 的返回值包含便于调用方查看的展开选项；直接 JSON.stringify 该内存结果会把展开选项当成用户显式设置。运行时 normalizeProjectDocument 的返回值应直接交给 serializeProjectConfig 写回，以保留显式覆盖来源；不要先克隆运行结果再当作原始配置。

职责登记不自动扩大所有检查的范围。例如 functionDocs 原本绑定 source，utils 被独立放到 source 之外后，若仍需要函数文档检查，应把 utils 加入该检查绑定。是否纳入每个检查由其绑定或显式范围决定，不从职责名称自动猜测。

用户在具体检查字段中填写的目录引用也会原样保留，例如 `${utils}/math/**/*.ts`；写回配置后再次修改 utils，范围继续联动，不会被固化为展开后的旧路径。
