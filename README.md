# @cxyi7/repo-guard

面向团队 Git 仓库的本地提交门禁，提供暂存文件 Stylelint/ESLint 自动修复、
Prettier 格式化、文件归位、单文件行数限制、JS/TS/Vue 单元测试、独立生产构建、Vue Lighthouse 推送前质量检查、
公共文件保护、TypeScript 推送前类型检查、企业微信备案和提交信息文件清单。

## 安装

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@0.12.3
npx repo-guard init
npx repo-guard doctor
```

新生成的配置默认启用 ESLint 自动修复、Prettier 自动格式化、文件归位、Vue/JS/TS 单文件行数门禁、
企业微信通知和 9 条通知级保护规则。只有检测到业务项目已安装 Stylelint 且已有 Stylelint 配置时，
`init` 才会同时启用 Stylelint；否则保留为关闭状态。业务项目必须自行安装并配置
所启用的 ESLint、Prettier、Stylelint；默认 ESLint 规则基线还需要 `@eslint/js`。
Vue Lighthouse 默认关闭，开启时业务项目还需
安装 `@lhci/cli`、提供 `lighthouserc.*` 和 Chrome。通知功能需要在
`.env.config` 中填写企业微信通知参数；`doctor` 会检查这些前置条件。
单元测试仅在新项目已经安装 Vitest 且存在 `test:unit` 脚本时由 `init` 自动开启；
已有项目迁移后保持关闭，可准备完成后通过开关开启。
TypeScript 门禁仅在新项目已经存在 `typecheck` 脚本时由 `init` 自动开启；已有项目迁移后保持关闭。
独立构建门禁仅在新项目已经存在 `build` 脚本时由 `init` 自动开启；已有项目迁移后保持关闭。

`init` 会：

1. 生成五个受管理的 Git Hook，包括 TypeScript、单元测试、独立构建和可选 Lighthouse 门禁使用的 `pre-push`；
2. 设置当前仓库的 `core.hooksPath=.githooks`；
3. 增量维护 `.gitattributes` 和 `.gitignore`；
4. 创建本地且被忽略的 `.env.config`；
5. 在配置不存在时生成 `repo-guard.config.json`；
6. 补充初始化、迁移、门禁启用、诊断和检查相关的 `guard:*` 脚本；
7. 在项目没有 `prepare` 脚本时添加 `repo-guard install-hooks`；
8. 单元测试自动开启时，在根目录 `AGENTS.md` 写入受管理的 AI 测试要求。

已有的非托管 Hook 不会被覆盖。重复执行 `init` 不会生成重复配置。

## 配置迁移与自动修复

```bash
repo-guard migrate
repo-guard doctor --fix
```

`migrate` 只补齐当前版本缺失的 `$schema`、`notification`、`build`、`typeCheck`、`unitTest`、`lighthouse`、`preCommit` 和默认
字段，保留已有保护规则、排除项和显式配置；重复执行不会继续改文件，也不会改变
已有项目已经显式配置的门禁开关。为避免升级后突然阻止现有提交，迁移得到的 `build`、`typeCheck`、`unitTest`、
`maxFileLines` 和 `preCommit.eslint.preset` 默认关闭；文件归位默认开启但使用 `newFiles` 模式，
只约束今后新增、复制或重命名到新位置的文件，不会因历史错位文件被普通修改而阻止提交。

`doctor --fix` 会先迁移配置，再重新生成托管 Hook、维护 `.gitattributes`、
`.gitignore`、`.env.config` 和 `guard:*` 项目脚本，最后执行完整诊断。它不会：

- 覆盖自定义 Git Hook 或替换其他 `core.hooksPath`；
- 自动解除已被 Git 跟踪的 `.env.config`；
- 安装 TypeScript、vue-tsc、Vitest、Vue Test Utils、ESLint、`@eslint/js`、Prettier、Stylelint、Lighthouse CI、Chrome 或生成业务项目的规则文件；
- 自动填写企业微信密钥或改写已有配置中的显式门禁开关。

## 提交顺序

```text
git commit
  → lint-staged 隔离本次暂存内容
  → Stylelint 检查和自动修复
  → ESLint 检查和自动修复
  → Prettier 检查或格式化
  → Stylelint 最终只读复检
  → ESLint 最终只读复检
  → 检查最终暂存文件的完整行数
  → 检查新增、复制或重命名文件的存放位置
  → 质量结果写回暂存区并恢复未暂存内容
  → 保护文件识别、指纹和企业微信通知
  → 提交信息文件清单
```

Stylelint、ESLint、Prettier、单文件行数或文件归位门禁失败时，`lint-staged` 恢复执行前状态并阻止提交。保护文件
门禁始终在代码质量门禁成功之后运行，因此通知和指纹对应最终暂存内容。

TypeScript 类型检查不会进入 `pre-commit`。开启 `typeCheck` 后，repo-guard 在 `pre-push`
运行项目自有的 `typecheck` npm 脚本；未开启时 `.ts`、`.tsx` 文件只接受项目 ESLint 配置支持的普通检查。

开启相关开关后，`git push` 的附加流程为：

```text
git push
  → npm run typecheck
  → 检查本次推送新增/修改的源码和测试文件
  → 检查映射得到的 .spec/.test 候选测试，以及禁止的 .skip/.only
  → npm run test:unit
  → 执行项目独立 npm build 脚本
  → @lhci/cli collect 按 lighthouserc 访问配置页面
  → @lhci/cli assert 检查性能、可访问性、最佳实践和 SEO 阈值
  → 全部通过后继续推送
```

启用 TypeScript、单元测试、独立构建或 Lighthouse 门禁后，受管理的 `pre-push` 会读取待推送提交中的
`repo-guard.config.json`，并要求待推送提交就是当前检出的 `HEAD`、工作区和暂存区均无改动。
这样 Vitest、项目构建和 Lighthouse 检查的就是实际推送内容，不会被未提交的本地修复或临时关闭
开关影响。一次推送包含多个不同提交时应拆成多次推送；纯删除远程引用不运行质量门禁。

## 项目配置

规则和代码质量配置都保存在项目根目录的 `repo-guard.config.json`：

```json
{
  "$schema": "./node_modules/@cxyi7/repo-guard/config.schema.json",
  "version": 1,
  "notification": {
    "enabled": true
  },
  "build": {
    "enabled": false,
    "script": "build",
    "timeoutMs": 300000
  },
  "typeCheck": {
    "enabled": false,
    "script": "typecheck",
    "timeoutMs": 180000
  },
  "unitTest": {
    "enabled": false,
    "script": "test:unit",
    "timeoutMs": 120000,
    "coverage": false,
    "requireTests": "newFiles",
    "sourcePatterns": [
      "src/utils/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
      "src/composables/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
      "src/stores/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
      "src/api/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
      "src/components/**/*.{js,jsx,ts,tsx,vue}"
    ],
    "testPatterns": ["**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    "mappings": [
      {
        "sourcePattern": "**/*.{js,mjs,cjs}",
        "testTemplates": [
          "{path}.spec.js",
          "{path}.test.js",
          "{dir}/__tests__/{name}.spec.js",
          "{dir}/__tests__/{name}.test.js"
        ]
      },
      {
        "sourcePattern": "**/*.jsx",
        "testTemplates": [
          "{path}.spec.js",
          "{path}.test.js",
          "{path}.spec.jsx",
          "{path}.test.jsx",
          "{dir}/__tests__/{name}.spec.jsx",
          "{dir}/__tests__/{name}.test.jsx"
        ]
      },
      {
        "sourcePattern": "**/*.{ts,mts,cts}",
        "testTemplates": [
          "{path}.spec.ts",
          "{path}.test.ts",
          "{dir}/__tests__/{name}.spec.ts",
          "{dir}/__tests__/{name}.test.ts"
        ]
      },
      {
        "sourcePattern": "**/*.tsx",
        "testTemplates": [
          "{path}.spec.tsx",
          "{path}.test.tsx",
          "{path}.spec.ts",
          "{path}.test.ts",
          "{dir}/__tests__/{name}.spec.tsx",
          "{dir}/__tests__/{name}.test.tsx"
        ]
      },
      {
        "sourcePattern": "**/*.vue",
        "testTemplates": [
          "{path}.spec.js",
          "{path}.test.js",
          "{path}.spec.ts",
          "{path}.test.ts",
          "{dir}/__tests__/{name}.spec.js",
          "{dir}/__tests__/{name}.spec.ts"
        ]
      }
    ],
    "exclusions": ["src/main.{js,ts}", "src/**/index.{js,ts}", "src/generated/**"]
  },
  "lighthouse": {
    "enabled": false,
    "configFile": null,
    "buildScript": "build",
    "timeoutMs": 300000
  },
  "preCommit": {
    "filePlacement": {
      "enabled": true,
      "mode": "newFiles",
      "rules": [
        {
          "name": "资源文件",
          "patterns": [
            "**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,bmp,tif,tiff}",
            "**/*.{woff,woff2,ttf,otf,eot}",
            "**/*.{mp3,wav,ogg,m4a,mp4,webm,mov,pdf}"
          ],
          "allowedPatterns": ["src/assets/**", "public/assets/**", "docs/assets/**"],
          "exceptions": ["public/favicon.{ico,png,svg}"],
          "suggestedDirectory": "src/assets"
        },
        {
          "name": "Markdown 文档",
          "patterns": ["**/*.md"],
          "allowedPatterns": ["docs/**", ".github/**", ".changeset/**"],
          "exceptions": [
            "README*.md",
            "CHANGELOG*.md",
            "AGENTS.md",
            "SECURITY.md",
            "CONTRIBUTING.md",
            "CODE_OF_CONDUCT.md",
            "LICENSE*.md"
          ],
          "suggestedDirectory": "docs"
        }
      ]
    },
    "maxFileLines": {
      "enabled": true,
      "mode": "strict",
      "warnAt": 0.85,
      "rules": [
        { "pattern": "**/*.vue", "maxLines": 700 },
        { "pattern": "**/*.{js,mjs,cjs,jsx}", "maxLines": 1000 },
        { "pattern": "**/*.{ts,tsx}", "maxLines": 1000 }
      ],
      "exclusions": []
    },
    "stylelint": {
      "enabled": false,
      "pattern": "**/*.{css,scss,sass,less,vue}",
      "fix": true,
      "maxWarnings": 0,
      "requireConfig": true
    },
    "prettier": {
      "enabled": true,
      "pattern": "*.{js,jsx,mjs,cjs,ts,tsx,vue,json,json5,jsonc,css,scss,less,html,md,mdx,yml,yaml}",
      "fix": true,
      "requireConfig": true
    },
    "eslint": {
      "enabled": true,
      "preset": true,
      "pattern": "*.{js,jsx,ts,tsx,vue}",
      "fix": true,
      "maxWarnings": 0
    }
  },
  "rules": [
    {
      "pattern": "src/components/**",
      "category": "公共组件",
      "level": "notify"
    }
  ],
  "exclusions": []
}
```

### 文件归位门禁

`preCommit.filePlacement` 默认开启，内置“资源文件”和“Markdown 文档”两组规则。资源默认只能放在
`src/assets/**`、`public/assets/**` 或 `docs/assets/**`，Markdown 默认只能放在 `docs/**`、
`.github/**` 或 `.changeset/**`；README、CHANGELOG、AGENTS 等标准根目录文档属于默认例外。

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | `true` | 是否在提交时启用文件归位门禁 |
| `mode` | `newFiles` | `newFiles` 只检查新增、复制和重命名后的路径；`changedFiles` 也检查修改的存量文件 |
| `rules` | 资源、Markdown 两组 | 按顺序匹配，第一条命中的规则生效 |
| `patterns` | 按规则定义 | 该规则负责的仓库相对路径 glob |
| `allowedPatterns` | 按规则定义 | 文件允许出现的位置 glob |
| `exceptions` | 按规则定义 | 明确允许跳过的文件路径 glob |
| `suggestedDirectory` | 按规则定义 | 失败提示提供给 AI 的建议目标目录，必须是具体目录而不是 glob |

提交失败时会按文件输出可直接交给 AI 的中文指令，包括当前路径、建议目标、允许位置、引用路径更新、
验证命令和禁止绕过要求。移动文件本身不是自动完成的，因为 AI 还需要同步修改 Vue、JavaScript、CSS、
HTML 和 Markdown 中的引用。

新增文件类型只需要在配置中增加规则，不需要改 npm 包代码。例如要求 Figma 和 Sketch 源文件统一放在
`design/**`，可将下面的规则对象追加到现有 `preCommit.filePlacement.rules` 数组：

```json
{
  "name": "设计源文件",
  "patterns": ["**/*.{fig,sketch}"],
  "allowedPatterns": ["design/**"],
  "exceptions": [],
  "suggestedDirectory": "design"
}
```

负责人需要一次性检查整个项目时，执行：

```bash
npm run guard:file-placement
# 或
npx repo-guard file-placement
```

`guard:file-placement` 项目脚本由 `repo-guard init` 或 `repo-guard doctor --fix` 自动补充；
尚未更新项目脚本时可以直接使用 `npx` 命令。

全项目命令检查所有已跟踪文件和未被 Git 忽略的未跟踪文件，并始终按全量模式检查，因此即使
`enabled: false` 或 `mode: "newFiles"` 也能用于专项治理。它只报告问题，不移动文件；通过
`.gitignore` 忽略的构建产物和依赖目录不会进入扫描。

### 单文件行数门禁

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 新项目 `true`；旧配置迁移后 `false` | 是否检查最终暂存文件的完整行数 |
| `mode` | `strict` | `strict` 严格限制；`noRegression` 允许存量超限文件不再增长 |
| `warnAt` | `0.85` | 达到限制比例时输出非阻断预警 |
| `rules` | Vue 700 行、JS/TS 1000 行 | 按顺序匹配，第一条命中的规则生效 |
| `exclusions` | `[]` | 排除生成代码等不适合人工拆分的仓库相对路径 |

门禁统计物理行数，空行和注释都计入；文件末尾是否有换行符不会额外增加一行。它在
格式化和最终 lint 复检后运行，因此判断的是本次实际提交的完整文件，而不是只统计
本次新增的行。部分暂存文件的未暂存内容会由 `lint-staged` 隔离，不会造成误判。

`strict` 模式下，最终文件超过限制就停止提交。旧项目存在大量历史超限文件时，可以使用
`noRegression`：门禁读取 `HEAD` 中同一文件作为基线，允许存量超限文件保持或缩短，但
只要继续增长就停止提交；新增文件和原本未超限的文件仍必须满足正式限制。文件重命名时
会沿用旧路径在 `HEAD` 中的基线。该模式适合逐步治理，不会把正常修复完全卡住：

```json
{
  "preCommit": {
    "maxFileLines": {
      "enabled": true,
      "mode": "noRegression",
      "warnAt": 0.85
    }
  }
}
```

达到 `warnAt`（默认 85%）但尚未超限时，门禁会输出剩余行数和提前拆分建议，但不会阻止
提交。存量超限文件在 `noRegression` 下持平或缩短时也会持续预警，直到低于正式限制。

超过限制时提交会被阻止，并为每个文件输出一段可单独复制给 AI 的完整重构指令。指令会
列出文件、当前行数、限制和至少需要减少的行数，并根据 Vue/JS/TS 文件给出不同拆分方向；
Vue 文件还会分别统计 `template`、`script`、`style` 的有效内容行数，指出最大的区域和
优先拆分方向。多个同类 Vue 区块会合并统计，标签外围的空白行不会计入区域数据。
同时要求保持接口和行为、限制修改范围、执行项目验证，并禁止通过删除必要注释、压缩代码、
修改阈值、关闭门禁、修改扩展名或增加排除项绕过检查。自动生成且无法合理拆分的文件可以显式排除，例如：

```json
{
  "preCommit": {
    "maxFileLines": {
      "enabled": true,
      "mode": "strict",
      "warnAt": 0.85,
      "rules": [
        { "pattern": "**/*.vue", "maxLines": 700 },
        { "pattern": "**/*.{js,mjs,cjs,jsx}", "maxLines": 1000 },
        { "pattern": "**/*.{ts,tsx}", "maxLines": 1000 }
      ],
      "exclusions": ["src/generated/**", "public/vendor/**"]
    }
  }
}
```

### 独立构建门禁

repo-guard 运行项目自己的生产构建 npm 脚本，不内置 Vite、Webpack、Vue CLI 或其他构建工具：

```json
{
  "scripts": {
    "build": "vite build"
  }
}
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 检测到脚本时新项目为 `true`；迁移后 `false` | 是否在受管理的 `pre-push` Hook 自动执行 |
| `script` | `build` | 业务项目的生产构建 npm 脚本名 |
| `timeoutMs` | `300000` | 构建进程最长运行时间 |

手动启用和检查：

```bash
repo-guard enable build
repo-guard doctor
repo-guard build
```

构建失败或超时会阻止推送，并要求 AI 修复源码、配置、依赖或资源根因，禁止把脚本改为空操作、
忽略错误、关闭生产优化或修改门禁绕过。当独立构建和 Lighthouse 配置使用同一个 npm 脚本时，
pre-push 只构建一次，Lighthouse 随后直接执行 collect/assert；脚本不同时分别执行各自构建。

### TypeScript 门禁

repo-guard 不内置或替换 TypeScript 工具链，而是运行业务项目自己的 npm 脚本。Vue 项目通常使用
`vue-tsc --noEmit`，普通 TypeScript 项目通常使用 `tsc --noEmit`：

```json
{
  "scripts": {
    "typecheck": "vue-tsc --noEmit"
  }
}
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 检测到脚本时新项目为 `true`；迁移后 `false` | 是否在受管理的 `pre-push` Hook 自动执行 |
| `script` | `typecheck` | 业务项目中运行 `tsc`、`vue-tsc` 或等价全项目类型检查的 npm 脚本名 |
| `timeoutMs` | `180000` | 类型检查进程最长运行时间 |

手动启用并诊断：

```bash
repo-guard enable typeCheck
repo-guard doctor
```

即使自动门禁关闭，也可以显式运行：

```bash
repo-guard typecheck
```

类型检查失败或超时会阻止推送，并要求 AI 修复类型根因和相关调用方，禁止通过 `any`、
`@ts-ignore`、`@ts-nocheck`、关闭 strict 选项或修改门禁来绕过。类型检查始终针对完整项目，
不尝试只检查暂存文件或变更文件，因为跨文件类型关系无法安全地局部验证。

### JS/TS/Vue 单元测试门禁

repo-guard 负责测试策略、推送范围识别和流程编排，测试框架、运行环境、Mock、覆盖率阈值和
具体用例仍由业务项目维护。纯 JavaScript 的 Vue 项目可以安装：

```bash
npm install --save-dev vitest @vue/test-utils jsdom
```

并在业务项目的 `package.json` 中提供脚本：

```json
{
  "scripts": {
    "test:unit": "vitest run"
  }
}
```

默认映射为每种源码生成多个允许的测试路径；任一候选文件包含有效测试即可通过：

```text
src/utils/money.js                 → src/utils/money.spec.js
                                    或 src/utils/money.test.js
                                    或 src/utils/__tests__/money.test.js
src/composables/usePagination.ts   → src/composables/usePagination.spec.ts
src/components/OrderForm.tsx       → src/components/OrderForm.spec.tsx
src/components/OrderForm.vue       → src/components/OrderForm.spec.js 或 .spec.ts
```

开启功能时，repo-guard 会增量维护根目录 `AGENTS.md` 中带标记的“前端单元测试要求”。AI 修改
目标源码时会先看到应测试的内容、文件位置和禁止绕过方式；文件原有人工内容不会被覆盖。
门禁则提供机器可执行的兜底：根据本次推送的精确 Git 范围检查测试是否存在，扫描本次修改的
测试文件是否使用 `describe/it/test.skip`、`.skipIf`、`.todo` 或 `.only`，随后自动运行完整的
`npm run test:unit`。扫描会忽略注释、字符串、模板字符串和正则表达式中的测试字样。

默认 `requireTests: "newFiles"` 只强制新增或复制的目标源码必须存在映射测试，适合已有项目
渐进接入；`changedFiles` 会要求每个被修改的目标源码都已有对应测试，适合测试基础较完整的项目。
即使选择 `newFiles`，本次推送仍会执行完整测试套件。静态门禁还会拒绝没有 `it/test` 用例的
空测试文件和 `.skip/.skipIf/.todo/.only` 绕过；断言是否充分等更深层语义由 AI 规范、评审和
覆盖率阈值共同约束。

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 检测到 Vitest 和脚本时新项目为 `true`；迁移后 `false` | 是否在受管理的 `pre-push` Hook 自动执行 |
| `script` | `test:unit` | 业务项目中运行 Vitest 的 npm 脚本名 |
| `timeoutMs` | `120000` | 单元测试进程最长运行时间 |
| `coverage` | `false` | 是否向脚本追加 `--coverage`；覆盖率 Provider 和阈值由项目提供 |
| `requireTests` | `newFiles` | `newFiles` 仅检查新增/复制源码；`changedFiles` 检查所有变更源码 |
| `sourcePatterns` | 工具、Composable、Store、API、组件 | 需要测试的 JS/JSX/TS/TSX/Vue 源码 glob |
| `testPatterns` | `**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}` | 扫描空测试和 `.skip/.skipIf/.todo/.only` 的测试 glob |
| `mappings` | 5 组默认映射 | 按顺序匹配源码，使用 `{dir}`、`{name}`、`{path}`、`{ext}` 生成候选测试路径 |
| `exclusions` | 入口、聚合导出、生成代码 | 不要求测试文件的源码 glob |

自定义映射示例：

```json
{
  "sourcePattern": "src/services/*.service.ts",
  "testTemplates": [
    "{path}.spec.ts",
    "tests/services/{name}.test.ts"
  ]
}
```

映射按数组顺序匹配，第一条命中的规则生效。自定义候选扩展名时，应同步把它加入
`testPatterns`，确保空测试和绕过扫描覆盖相同文件。

自动开启或手动开启只需要控制开关，不需要再导入 repo-guard 配置：

```bash
repo-guard enable unitTest
repo-guard doctor
```

也可以在不改变开关的情况下显式运行同一套检查：

```bash
repo-guard unit-test
```

缺少测试时会列出源码路径和唯一预期的测试路径，并输出可以直接交给 AI 的要求；测试失败时
保留 Vitest 原始输出，再明确要求修复代码或用例，禁止删除测试、降低必要断言或关闭门禁。

### Vue Lighthouse 配置

Lighthouse 当前只支持根目录 `package.json` 声明了 `vue` 的项目。业务项目自行安装：

```bash
npm install --save-dev @lhci/cli
```

repo-guard 不内置 Lighthouse、Chrome、页面列表或分数阈值。`lighthouse.enabled` 只控制
是否在 `pre-push` 自动运行；即使为 `false`，也可以手动执行：

```bash
repo-guard lighthouse
repo-guard lighthouse --skip-build
repo-guard enable lighthouse
repo-guard doctor
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | `false` | 是否在受管理的 `pre-push` Hook 自动执行 |
| `configFile` | `null` | 指定仓库内配置；`null` 自动查找标准 `lighthouserc.*` 文件名 |
| `buildScript` | `build` | 收集数据前运行的 npm 脚本；`null` 表示不构建 |
| `timeoutMs` | `300000` | 构建、收集和断言各自的超时时间 |

Vite + Vue 项目可以配置：

```json
{
  "scripts": {
    "build": "vite build",
    "preview:lhci": "vite preview --host 127.0.0.1 --port 4173"
  }
}
```

`lighthouserc.cjs`：

```js
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run preview:lhci',
      startServerReadyPattern: 'Local',
      numberOfRuns: 3,
      url: [
        'http://127.0.0.1:4173/',
        'http://127.0.0.1:4173/login',
        'http://127.0.0.1:4173/dashboard',
      ],
    },
    assert: {
      assertions: {
        'categories:performance': ['error', {
          minScore: 0.8,
          aggregationMethod: 'median',
        }],
        'categories:accessibility': ['error', {
          minScore: 0.9,
          aggregationMethod: 'median',
        }],
        'categories:best-practices': ['error', {
          minScore: 0.9,
          aggregationMethod: 'median',
        }],
        'categories:seo': ['warn', {
          minScore: 0.9,
          aggregationMethod: 'median',
        }],
        'largest-contentful-paint': ['error', {
          maxNumericValue: 2500,
          aggregationMethod: 'median',
        }],
        'cumulative-layout-shift': ['error', {
          maxNumericValue: 0.1,
          aggregationMethod: 'median',
        }],
      },
    },
  },
};
```

Vue Router 的路由不会被自动猜测，必须写入 `collect.url`。`numberOfRuns: 3` 表示每个
URL 收集三次，断言使用中位数降低波动。多页静态项目也可以改用 `staticDistDir`。
repo-guard 只执行 `collect` 和 `assert`，不会执行 LHCI upload，也不会把报告上传到外部；
原始报告保存在已被 `.gitignore` 排除的 `.lighthouseci/`。

### Stylelint 配置

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 检测到本地安装和配置时 `true`；否则 `false` | 是否启用暂存样式文件门禁 |
| `pattern` | `**/*.{css,scss,sass,less,vue}` | `lint-staged` 文件匹配规则 |
| `fix` | `true` | 是否应用 Stylelint 自动修复 |
| `maxWarnings` | `0` | 提交允许的最大警告数 |
| `requireConfig` | `true` | 是否要求项目根目录存在 Stylelint 配置 |

Stylelint 必须由业务项目自行安装和配置，支持 `>=16 <18`。repo-guard 只加载项目
本地的 Stylelint、插件、自定义语法和规则，不会内置规则预设、自动安装依赖、探测
CSS/SCSS/Less/Vue 语言组合或生成 `stylelint.config.*`。准备完成后可执行：

```bash
repo-guard enable stylelint
repo-guard doctor
```

同一个 Vue 文件可以包含多个相同语言的 `<style>` 块，但不能混用不同语言；例如
同时出现 `<style>` 和 `<style lang="scss">` 时，提交会在调用 Stylelint 前直接失败。
自动修复后 repo-guard 会再次只读检查；仍有问题时恢复 Stylelint 修改并输出编号式
中文 AI 修复指令。所有处理都限定在暂存文件，部分暂存文件的未暂存内容会被保留。

### ESLint 配置

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 新项目 `true`；旧配置缺省 `false` | 是否启用暂存文件 ESLint 门禁 |
| `preset` | 新项目 `true`；旧配置缺省 `false` | 是否自动注入 repo-guard AI 可维护性规则基线 |
| `pattern` | `*.{js,jsx,ts,tsx,vue}` | `lint-staged` 文件匹配规则 |
| `fix` | `true` | 是否应用 ESLint 自动修复 |
| `maxWarnings` | `0` | 提交允许的最大警告数 |

ESLint 必须由业务项目自行安装和配置。repo-guard 使用项目本地的 ESLint，
不会强制替换项目的 ESLint 版本、插件或规则。项目 ESLint 配置中忽略的文件
不会阻止提交。

`preset: true` 后不需要在 `eslint.config.js` 中 import repo-guard。门禁会从业务项目
加载 ESLint 和 `@eslint/js`，把 repo-guard 规则作为 Flat Config 基础配置注入，再
加载项目原有的 `eslint.config.*`。因此项目规则天然位于后面并拥有最终覆盖权：

```text
repo-guard AI 规则基线 → 项目 eslint.config.* → ESLint 执行
```

例如基线的 `complexity` 阈值是 `15`，项目原有配置写成下面这样时，最终使用项目的
`20`，无需复制或修改 repo-guard 规则：

```js
export default [
  {
    rules: {
      complexity: ['error', 20],
      'no-warning-comments': 'off',
    },
  },
];
```

自动规则基线要求 ESLint `>=9.19` 和 `@eslint/js`；Vue、TypeScript 规则只在业务
项目已安装对应插件时自动加入。未使用 Vue 或 TypeScript 时不需要安装对应插件：

```bash
npm install --save-dev eslint @eslint/js
# Vue 项目按需安装 eslint-plugin-vue
# TypeScript 项目按需安装 typescript-eslint
```

`preset: false` 时只运行项目原有 ESLint 配置。新项目初始化默认开启；已有配置迁移
时默认关闭，避免包升级后突然增加阻断规则。`doctor` 会检查 ESLint 版本、
`@eslint/js` 和已发现的可选插件，并输出实际启用的集成。

该基线包含以下规则组：

- ESLint 推荐规则，以及未使用禁用注释和未使用行内配置检查；
- 复杂度、嵌套深度、函数行数、参数数量和回调嵌套限制；
- 强制大括号、严格相等、`const`，并禁止 `eval`、隐式 `eval`、`Function`
  构造器、`debugger`、`var` 和未处理的 TODO/FIXME/HACK；
- Vue 推荐规则，以及组合式 API、按钮类型、props 数量、模板深度和 emit 校验；
- TypeScript 推荐和风格规则、类型导入一致性；显式 `any` 默认作为警告，而门禁
  默认 `maxWarnings: 0`，因此仍会阻止提交，项目可以在后置配置中渐进调整。

该预设只使用不需要类型信息的 TypeScript 规则，不会在 pre-commit 中运行 `tsc`、
`vue-tsc` 或 `recommendedTypeChecked`；需要类型信息的检查应由项目在独立 CI
命令中执行。

不要把全项目 `npm run lint:fix` 配置成 Hook 命令。repo-guard 只对暂存文件
执行修复，避免把同一文件中的未暂存内容或其他任务改动带入提交。

如果 ESLint 自动修复后仍有问题，repo-guard 会按 `1.`、`2.` 编号输出每一个
问题。每段都包含文件、行列、规则、原始错误和修复约束，可单独完整复制给 AI；
提示会明确要求 AI 不得关闭 ESLint 规则或修改无关文件。

### Prettier 配置

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 新项目 `true`；旧配置缺省 `false` | 是否启用暂存文件 Prettier 门禁 |
| `pattern` | 常见代码、样式、数据和文档扩展名 | 需要格式化的暂存文件 |
| `fix` | `true` | 自动格式化；设为 `false` 时只检查并阻止不合规提交 |
| `requireConfig` | `true` | 是否要求匹配文件必须找到项目 Prettier 配置 |

Prettier 必须由业务项目安装为开发依赖，支持 `>=3 <4`。repo-guard 加载业务项目
本地的 Prettier，并使用项目已有的 `.prettierrc`、`prettier.config.*` 或
`package.json#prettier` 规则。`.gitignore` 和 `.prettierignore` 中的文件不会被
格式化。

建议在 ESLint Flat Config 数组最后添加 `eslint-config-prettier`，关闭相互冲突的
格式规则。无需启用
`eslint-plugin-prettier`，格式化由独立的 Prettier 门禁负责。

### 保护文件规则

- `notify`：企业微信通知成功后允许提交。
- `audit`：计入检查和提交清单，但不发送通知。
- `*` 不跨目录，`**` 可以跨任意目录。
- 第一条命中的规则生效，`exclusions` 优先于规则。

## 通知配置

企业微信通知默认开启，可以通过配置或命令关闭：

```json
{
  "notification": {
    "enabled": false
  }
}
```

```bash
repo-guard disable notification
repo-guard enable notification
```

关闭后，`notify` 级文件仍会被识别并写入提交信息，但不会校验通知参数、发送网络
请求或阻止提交。`audit` 规则始终只记录、不通知。

`init` 创建不会被提交的 `.env.config`：

```dotenv
REPO_GUARD_WECOM_WEBHOOK=
REPO_GUARD_MENTION_MOBILES=
```

系统同名环境变量优先于文件值。`.env.config` 被普通 Git 操作忽略；即使使用
`git add -f` 强制暂存，提交门禁也会阻止泄漏。

## 常用命令

```bash
repo-guard init
repo-guard install-hooks
repo-guard migrate
repo-guard enable eslint prettier stylelint maxFileLines filePlacement typeCheck unitTest build
repo-guard disable filePlacement
repo-guard file-placement
repo-guard build
repo-guard typecheck
repo-guard unit-test
repo-guard lighthouse
repo-guard enable lighthouse
repo-guard disable lighthouse
repo-guard enable notification
repo-guard disable notification
repo-guard doctor
repo-guard doctor --fix
repo-guard check
repo-guard dry-run
repo-guard gate --dry-run
```

`doctor` 会检查 Node.js、配置、Hook 版本、TypeScript 和构建脚本、项目 Vitest 和测试脚本、AI 测试规范、Lighthouse CI、
Stylelint、ESLint、Prettier、单文件行数、文件归位门禁配置和通知设置。`enable`/`disable` 只修改指定功能的 `enabled` 字段，随后应运行
`doctor` 验证业务项目依赖和配置是否完整。

## 升级到 0.12.3

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@0.12.3
npx repo-guard doctor --fix
npx repo-guard doctor
```

0.7.0 继续使用 `version: 1` 配置和 v2 托管 Hook。升级已有配置时，迁移只会补充
默认关闭的 `preCommit.stylelint`，不会因为仓库中存在样式文件而自动开启。项目完成
Stylelint 安装和配置后，再执行 `npx repo-guard enable stylelint`。

0.8.0 会把托管 Hook 升级为 v3，并新增默认关闭的
`lighthouse` 配置。执行 `doctor --fix` 可升级 v1/v2 托管 Hook；只有显式执行
`repo-guard enable lighthouse` 后，推送前门禁才会运行。

0.9.0 新增单文件行数门禁和由 `preCommit.eslint.preset` 控制的自动 ESLint 规则
基线。已有项目执行迁移时两项均保持关闭；评估存量代码后，可执行
`repo-guard enable maxFileLines`，并在配置中把 ESLint `preset` 改为 `true`。

0.10.0 新增 `unitTest` 配置、JS/Vue 同目录测试要求、受管理的 `AGENTS.md` AI 规范和
pre-push 自动 Vitest 门禁，同时把托管 Hook 升级为 v4。已有项目迁移后测试开关保持关闭；
准备好 Vitest 与 `test:unit` 后执行 `repo-guard enable unitTest`，再运行 `doctor --fix`。

0.11.0 加强 pre-push 的提交范围和工作区校验，确保单元测试、构建与 Lighthouse 针对实际推送内容执行，
并补强单元测试绕过识别、Hook 升级和配置诊断。

0.12.0 新增默认开启的 `preCommit.filePlacement` 文件归位门禁。已有项目迁移后使用 `newFiles`
模式，只约束新增、复制和重命名后的路径；运行 `doctor --fix` 会补充全项目专项检查脚本
`guard:file-placement`。如需关闭日常提交检查，可执行 `repo-guard disable filePlacement`。

0.12.1 新增 `typeCheck` 配置、`repo-guard typecheck` 显式命令和 pre-push TypeScript 门禁。
新项目存在 `typecheck` npm 脚本时自动开启；已有配置迁移后保持关闭，可准备完成后执行
`repo-guard enable typeCheck`。类型检查只运行项目脚本，不进入 pre-commit，也不内置或安装 TypeScript。

0.12.2 新增 `build` 配置、`repo-guard build` 显式命令和独立 pre-push 生产构建门禁。
新项目存在 `build` npm 脚本时自动开启；已有配置迁移后保持关闭，可执行 `repo-guard enable build`。
独立构建与 Lighthouse 使用同一脚本时会复用构建结果，避免一次推送重复构建。

0.12.3 扩展 `unitTest.mappings`，默认支持 JS/JSX/TS/TSX/Vue、`.spec`、`.test` 和
`__tests__` 候选位置。映射按顺序匹配，任一候选测试有效即可通过；已有项目显式配置的
`sourcePatterns` 和 `testPatterns` 会在迁移时保留。
