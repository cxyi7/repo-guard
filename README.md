# @cxyi7/repo-guard

面向团队 Git 仓库的本地提交门禁，提供 Vue 表单 label、`v-html` 与 `target="_blank"` 硬性检查、结构化限时例外、暂存文件 Stylelint/ESLint 自动修复、
Prettier 格式化、选择器与样式嵌套复杂度、依赖声明治理、文件归位、单文件行数限制、JS/TS/Vue 单元测试、axe 可访问性测试、依赖架构、独立生产构建、Vue Lighthouse 推送前质量检查、
公共文件保护、TypeScript 推送前类型检查、企业微信备案和提交信息文件清单。

## 安装

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@0.15.0
npx repo-guard init
npx repo-guard doctor
```

需要 Node.js `22.23.2` 或更高版本；建议使用最新的 Node.js 22 LTS 补丁版本。

Vue 表单 label、`v-html` 和 `target="_blank"` 门禁始终启用且没有关闭开关。新生成的配置默认启用 ESLint 自动修复、Prettier 自动格式化、依赖治理、文件归位、Vue/JS/TS 单文件行数门禁、
企业微信通知和 9 条通知级保护规则。只有检测到业务项目已安装 Stylelint 且已有 Stylelint 配置时，
`init` 才会同时启用 Stylelint 及默认的选择器与嵌套复杂度门禁；否则保留为关闭状态。业务项目必须自行安装并配置
所启用的 ESLint、Prettier、Stylelint；默认 ESLint 规则基线还需要 `@eslint/js`。
Vue Lighthouse 默认关闭，开启时业务项目还需
安装 `@lhci/cli`、提供 `lighthouserc.*` 和 Chrome。通知功能需要在
`.env.config` 中填写企业微信通知参数；`doctor` 会检查这些前置条件。
单元测试仅在新项目已经安装 Vitest 且存在 `test:unit` 脚本时由 `init` 自动开启；
已有项目迁移后保持关闭，可准备完成后通过开关开启。
axe 可访问性测试仅在新项目已有 `test:a11y`、匹配测试文件、受支持集成、真实扫描和零违规断言时自动开启；已有项目迁移后保持关闭。
TypeScript 门禁仅在新项目已经存在 `typecheck` 脚本时由 `init` 自动开启；已有项目迁移后保持关闭。
独立构建门禁仅在新项目已经存在 `build` 脚本时由 `init` 自动开启；已有项目迁移后保持关闭。
依赖架构门禁仅在新项目已安装 dependency-cruiser 且存在默认 `src` 路径时自动开启；已有项目迁移后保持关闭。

`init` 会：

1. 生成五个受管理的 Git Hook，包括 TypeScript、单元测试、axe 可访问性测试、依赖架构、独立构建和可选 Lighthouse 门禁使用的 `pre-push`；
2. 设置当前仓库的 `core.hooksPath=.githooks`；
3. 增量维护 `.gitattributes` 和 `.gitignore`；
4. 创建本地且被忽略的 `.env.config`；
5. 在配置不存在时生成 `repo-guard.config.json`；
6. 补充初始化、迁移、门禁启用、诊断和检查相关的 `guard:*` 脚本；
7. 在项目没有 `prepare` 脚本时添加 `repo-guard install-hooks`；
8. 单元测试自动开启时，在根目录 `AGENTS.md` 写入受管理的 AI 测试要求；
9. 依赖架构门禁自动开启时，在同一文件写入受管理的 AI 架构硬性要求；
10. axe 门禁自动开启时，写入受管理的可访问性测试要求；
11. 始终增量维护结构化例外、Vue 表单 label、图片 alt、`v-html` 和新窗口链接安全的 AI 禁止绕过要求。

已有的非托管 Hook 不会被覆盖。重复执行 `init` 不会生成重复配置。

## 配置迁移与自动修复

```bash
repo-guard migrate
repo-guard doctor --fix
```

`migrate` 只补齐当前版本缺失的 `$schema`、`notification`、`exceptions`、`dependencyPolicy`、`architecture`、`build`、`typeCheck`、`unitTest`、`accessibilityTest`、`lighthouse`、`preCommit` 和默认
字段，保留已有保护规则、排除项和显式配置；重复执行不会继续改文件，也不会改变
已有项目已经显式配置的门禁开关。为避免升级后突然阻止现有提交，迁移得到的 `dependencyPolicy`、`architecture`、`build`、`typeCheck`、`unitTest`、`accessibilityTest`、
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
  → 检查 Vue 模板中的 v-html 及精确结构化例外
  → 检查 target="_blank" 的 noopener、noreferrer 及精确结构化例外
  → 检查 Vue 原生表单控件的 label 及精确结构化例外
  → 检查最终暂存文件的完整行数
  → 检查新增、复制或重命名文件的存放位置
  → 质量结果写回暂存区并恢复未暂存内容
  → package.json/package-lock.json 变更时按最终 Git 暂存快照检查依赖声明与锁文件
  → 保护文件识别、指纹和企业微信通知
  → 提交信息文件清单
```

Vue 表单 label、`v-html`、`target="_blank"`、Stylelint、ESLint、Prettier、单文件行数或文件归位门禁失败时，`lint-staged` 恢复执行前状态并阻止提交。保护文件
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
  → dependency-cruiser 执行完整依赖架构规则并输出统一报告
  → 执行项目独立 npm build 脚本
  → @lhci/cli collect 按 lighthouserc 访问配置页面
  → @lhci/cli assert 检查性能、可访问性、最佳实践和 SEO 阈值
  → 全部通过后继续推送
```

启用 TypeScript、单元测试、依赖架构、独立构建或 Lighthouse 门禁后，受管理的 `pre-push` 会读取待推送提交中的
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
  "ci": {
    "enabled": false,
    "profile": "policy",
    "reportPath": "reports/repo-guard.json",
    "protectedFiles": { "action": "report" }
  },
  "exceptions": {
    "warningDays": 14,
    "maxDays": 90,
    "entries": []
  },
  "dependencyPolicy": {
    "enabled": true,
    "requireExactVersions": true,
    "requireLockfile": true,
    "allowedProtocols": ["npm", "workspace"],
    "bannedPackages": []
  },
  "architecture": {
    "enabled": false,
    "timeoutMs": 120000,
    "sourcePaths": ["src"],
    "tsConfig": null,
    "exclude": "(?:^|/)(?:node_modules|dist|coverage|\\.git)/",
    "rules": [
      {
        "name": "no-circular",
        "comment": "Do not create circular dependencies.",
        "severity": "error",
        "from": { "path": "^src/" },
        "to": { "circular": true }
      },
      {
        "name": "no-unresolved",
        "comment": "Every project import must resolve.",
        "severity": "error",
        "from": { "path": "^src/" },
        "to": { "couldNotResolve": true }
      },
      {
        "name": "no-production-to-tests",
        "comment": "Production code must not import test-only modules.",
        "severity": "error",
        "from": {
          "path": "^src/",
          "pathNot": "(?:^|/)(?:__tests__|tests?)/|\\.(?:spec|test)\\.[cm]?[jt]sx?$"
        },
        "to": {
          "path": "(?:^|/)(?:__tests__|tests?)/|\\.(?:spec|test)\\.[cm]?[jt]sx?$"
        }
      }
    ]
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
  "accessibilityTest": {
    "enabled": false,
    "script": "test:a11y",
    "timeoutMs": 180000,
    "testPatterns": [
      "**/*.a11y.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
      "**/accessibility/**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"
    ]
  },
  "unitTest": {
    "enabled": false,
    "script": "test:unit",
    "timeoutMs": 120000,
    "coverage": {
      "enabled": false,
      "reportsDirectory": "coverage",
      "thresholds": {
        "lines": 80,
        "statements": 80,
        "functions": 80,
        "branches": 80,
        "changedLines": 90
      }
    },
    "componentInteraction": {
      "enabled": false,
      "componentPatterns": ["src/components/**/*.vue"]
    },
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
      "requireConfig": true,
      "complexity": {
        "enabled": false,
        "maxCompoundSelectors": 3,
        "maxNestingDepth": 3
      },
      "governance": {
        "enabled": false,
        "maxSpecificity": "0,3,0",
        "maxIdSelectors": 0,
        "disallowImportant": true,
        "allowedGlobalStylePatterns": [
          "src/styles/**",
          "src/assets/styles/**",
          "src/assets/css/**",
          "src/assets/main.{css,scss,sass,less}",
          "src/main.{css,scss,sass,less}",
          "src/index.{css,scss,sass,less}",
          "src/style.{css,scss,sass,less}",
          "src/App.vue"
        ]
      }
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

### GitLab CI 远程门禁

repo-guard 可以接入已经存在的 GitLab CI。它不会覆盖业务项目的 `.gitlab-ci.yml`，而是生成受管理的 `.gitlab/ci/repo-guard.yml`，并在能够安全判断现有结构时向根 CI 增加 `include + extends`：

```bash
repo-guard install-ci --provider gitlab --profile policy --dry-run
repo-guard install-ci --provider gitlab --profile policy
repo-guard doctor --ci
```

`policy` 适合已有 ESLint、测试和构建 Job 的项目，只运行 repo-guard 自有的全仓硬性安全/Vue 可访问性、结构化例外、依赖、文件归位、行数、测试语义和保护文件策略；`full` 还会以只读方式运行已启用的 Stylelint、ESLint、Prettier、类型检查、单元测试与覆盖率、axe、架构和构建。两种 profile 都不会执行 fix、安装 Hook、读取本地企业微信密钥、发送通知或运行 Lighthouse。模板设置 `REPO_GUARD_SKIP_HOOKS=1`，因此业务项目的 `prepare: repo-guard install-hooks` 即使被 `npm ci` 触发，也不会在 Runner 中写 Hook 或 Git 配置。

已有根 CI 包含复杂 `include`、已有 `repo_guard` Job、无法无歧义识别的 YAML 结构，或没有可安全选择的 `verify/test/quality` stage 时，安装器只生成受管理模板并打印需要人工审查加入的片段，不修改根 CI。块式和简单内联数组形式的 `stages` 均可自动识别；可以用 `--stage <name>` 明确选择已声明的 stage。

GitLab 模板使用 Node.js 22.23.2、完整 Git 历史（`GIT_DEPTH: "0"`）、`npm ci`、npm 下载缓存，并在 MR 和默认分支流水线中执行：

```yaml
include:
  - local: /.gitlab/ci/repo-guard.yml

repo_guard:
  extends: .repo_guard_policy
  stage: verify
```

CI 优先读取 `CI_MERGE_REQUEST_DIFF_BASE_SHA` 和 `CI_COMMIT_SHA`，普通分支流水线使用 `CI_COMMIT_BEFORE_SHA`。基准提交不在浅克隆中时退出码为 `3` 并提示补充 Git 历史，不能静默跳过变更测试或变更行覆盖率。也可显式运行：

```bash
repo-guard ci --profile policy --base <sha> --head <sha>
```

退出码 `0` 表示通过，`1` 表示配置或执行错误，`2` 表示门禁违规，`3` 表示无法取得可信变更范围。识别出仓库后，JSON 报告即使失败也会写入 `ci.reportPath`，该路径必须是 `reports/` 内的 `.json` 文件且不能覆盖 Git 已跟踪文件或经过符号链接；模板以 `when: always` 保留整个目录。保护文件默认仅报告；设置 `ci.protectedFiles.action` 为 `fail` 时会阻断 CI。审批人要求仍应由 GitLab approval rules/CODEOWNERS 管理，repo-guard 不调用平台 API，也不保存 Token。

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

### 结构化例外机制

规则例外统一登记在 `exceptions.entries`，不接受散落在源码中的豁免注释、普通 ignore 或关闭规则。例外不提供自动新增命令，必须由有权人员审查后手工登记；AI 发现需要例外时应停止并请求审批。

```json
{
  "exceptions": {
    "warningDays": 14,
    "maxDays": 90,
    "entries": [
      {
        "id": "legacy-trusted-renderer",
        "rule": "vue/no-v-html",
        "path": "src/components/LegacyPanel.vue",
        "line": 12,
        "column": 7,
        "reason": "Legacy trusted renderer awaiting replacement.",
        "owner": "frontend-team",
        "approvedBy": "security-team",
        "ticket": "SEC-1234",
        "createdOn": "2026-08-01",
        "expiresOn": "2026-08-31"
      }
    ]
  }
}
```

约束如下：

- `id` 全局唯一；`rule` 必须是命名空间规则 ID。
- `path` 必须是单个精确仓库相对文件，禁止 glob、父目录跳转和目录范围豁免。
- `line`、`column` 必须与规则发现的位置完全一致；移动后的违规不会继承旧例外。
- `owner` 与 `approvedBy` 必须不同；`reason`、`ticket`、创建日和到期日均必填。
- 有效期不得超过 `maxDays`，默认 90 天；到期立即阻断普通命令，未来日期同样无效。
- 距到期不超过 `warningDays` 时进入预警；默认提前 14 天。

```bash
repo-guard exceptions
repo-guard doctor
```

`repo-guard exceptions` 是只读报告，不修改登记表。`init` 和 `doctor --fix` 会在 `AGENTS.md` 增量维护结构化例外硬性要求，明确禁止 AI 新增、延期或改审批信息绕过。后续安全、依赖和样式规则通过相同的规则 ID、路径、行列调用这套机制。

### 动态代码执行安全门禁

repo-guard 始终检查 JavaScript、TypeScript、JSX、TSX 和 Vue `<script>` 中的 `eval` 与 `Function` 构造器。该门禁不依赖 ESLint 或业务项目配置，即使所有可选质量门禁关闭，发现仍会阻止提交。

门禁覆盖 `eval(value)`、`(0, eval)(value)`、`window.eval`、`globalThis['eval']`、`new Function(...)`、直接 `Function(...)` 以及从 `window`、`globalThis`、`self`、`global` 获取这些能力后再调用的简单别名。扫描器跳过注释、普通字符串、正则字面量和模板字符串文本，但会继续分析模板表达式 `${...}`；Vue 只扫描 `<script>` 和 `<script setup>`，不把模板或样式中的文本当作脚本。

规则 ID 分别为 `security/no-eval` 和 `security/no-function-constructor`。应将字符串输入改为明确的数据解析（优先 `JSON.parse`）、白名单分支或预先声明的函数映射，并保持原有合法输入、错误处理和接口兼容。AI 不得改用间接调用、全局对象、可选链或方括号属性绕过；确有遗留场景只能由有权人员手工登记精确、限时的结构化例外。

可以显式执行全项目检查：

```bash
repo-guard dynamic-code
```

`init` 或 `doctor --fix` 会补充 `guard:dynamic-code` 项目脚本和 AGENTS.md 硬性要求。该门禁没有 `enable` 或 `disable` 命令。

### Vue v-html 安全门禁

repo-guard 始终检查暂存 `.vue` 文件根 `<template>` 中的 `v-html`。该门禁不依赖业务项目的 ESLint、`eslint-plugin-vue` 或配置开关；即使所有可选质量门禁关闭，未经批准的 `v-html` 仍会阻止提交。

扫描器只分析 Vue 模板标签属性，跳过 `<script>`、HTML 注释和 `{{ }}` 插值中的字符串，并支持嵌套 `<template>` 和跨行属性。发现位置以 `v-html` 属性名的首字符为准，统一使用规则 ID `vue/no-v-html`。

首选修复方式是 Vue 模板、组件、插值或文本渲染。如果确实需要受信任富文本，必须建立可信来源和严格消毒边界，再由有权人员在 `exceptions.entries` 手工登记精确规则、文件、行、列和到期日。移动属性后旧例外不会继续生效，AI 不得自行新增或调整例外。

可以显式执行全项目检查：

```bash
repo-guard unsafe-html
```

命令会检查 Git 已跟踪和未忽略的未跟踪 `.vue` 文件，报告未经批准的发现，以及已批准例外的 ID 和到期日。项目初始化或 `doctor --fix` 还会补充 `guard:unsafe-html` 脚本。该硬性门禁没有对应的 `enable` 或 `disable` 命令。

### Vue target="_blank" 安全门禁

Vue 模板中可静态判定为 `target="_blank"` 的标签，必须在同一标签包含 `rel="noopener noreferrer"`。已有的 `external`、`nofollow` 等其他 `rel` token 可以保留，token 顺序和大小写不影响检查；与安全目标冲突的 `opener` token 会被拒绝。

门禁支持以下安全写法：

```vue
<a href="https://example.com" target="_blank" rel="noopener noreferrer">文档</a>
<a :href="url" :target="'_blank'" :rel="'external noreferrer noopener'">文档</a>
```

静态 `target`、简单的 `:target="'_blank'"` 和 `v-bind:target` 字面量都会检查。动态 `rel` 无法静态证明包含两个安全 token，因此不会被当作安全写法；应改成静态值或可分析的绑定字面量。完全动态且无法确定是否为 `_blank` 的 `target` 不在本规则的静态判定范围内，应由项目类型、测试和代码审查约束。

未经批准的问题使用规则 ID `vue/target-blank-security`，例外精确匹配 `target` 属性名的文件、行、列。AI 应优先补齐安全属性，不得把静态属性改成动态表达式绕过分析，也不得自行登记例外。

全项目检查命令为：

```bash
repo-guard target-blank
```

`init` 或 `doctor --fix` 会补充 `guard:target-blank`；该硬性门禁没有关闭命令。

### Vue 表单控件 label 门禁

repo-guard 始终检查 Vue 根模板中的原生 `input`、`select` 和 `textarea`，要求每个需要命名的控件具有可静态验证的无障碍名称。接受以下写法：

```vue
<label for="email">邮箱</label>
<input id="email">

<label>姓名 <input></label>
<input aria-label="站内搜索">
<span id="phone-label">手机号</span>
<input aria-labelledby="phone-label">
```

`input[type=hidden|button|submit|reset|image]` 不要求额外 label；自定义 Vue 组件不由本规则假定为原生控件。`placeholder`、`title`、空字符串和无法静态证明非空的动态 `aria-label` 不会被当作 label。静态属性及简单绑定字面量可以解析，例如 `:aria-label="'搜索'"`、`:id="'email'"` 和 `:for="'email'"`。

`aria-labelledby` 的每个静态 token 都必须指向模板中现有的静态 id；外部动态渲染关系无法证明，因此应改成明确的模板关联或经过审批的精确结构化例外。未经批准的问题使用规则 ID `vue/form-control-label`，发现位置指向控件标签名。

全项目检查命令为：

```bash
repo-guard form-labels
```

`init` 或 `doctor --fix` 会补充 `guard:form-labels`；该硬性门禁没有关闭命令，也不依赖项目是否安装 ESLint 或可访问性插件。

### Vue 图片 alt 门禁

repo-guard 始终检查 Vue 根模板中的原生 `<img>`，要求图片具有可静态验证且符合页面用途的 `alt`。内容图片必须使用简洁、准确的非空说明；纯装饰图片必须同时使用空 `alt` 与静态装饰角色：

```vue
<img src="release-chart.png" alt="本周发布成功率为 98% 的趋势图">
<img src="divider.svg" alt="" role="presentation">
<img src="background-shape.svg" :alt="''" :role="'none'">
```

门禁会拒绝缺少 `alt`、无法静态证明的动态 `alt`、没有明确装饰角色的空 `alt`、与非空 `alt` 冲突的 `none`/`presentation` 角色，以及 `图片`、`icon`、`image`、`photo.jpg` 或空白字符引用等无意义文本。重复 `alt`/`role` 和无参数 `v-bind="attrs"` 也会失败，避免运行时对象覆盖已检查的语义。简单绑定字面量可以解析；运行时表达式若确实无法改为静态语义，必须由负责人登记精确、限期的结构化例外。

未经批准的问题使用规则 ID `vue/img-alt`，发现位置指向原生 `img` 标签名。AI 报告会同时给出失败原因、针对性修复、兼容边界、禁止绕过项和验证要求；不得用 `title`、`aria-label` 或动态绑定代替合适的 `alt`。

全项目检查命令为：

```bash
repo-guard image-alt
```

`init` 或 `doctor --fix` 会补充 `guard:image-alt`；该硬性门禁没有关闭命令，也不依赖项目是否安装 ESLint 或可访问性插件。

### 依赖治理门禁

依赖治理检查根目录 `package.json` 与 npm `package-lock.json`。新项目由 `init` 默认开启；已有项目迁移后保持关闭，评估存量依赖后再启用。只有根清单或锁文件被暂存时才进入 `pre-commit`，并直接读取 Git 暂存快照，因此不会混入未暂存内容，也不能通过只删除锁文件绕过。显式命令不受开关限制，可用于启用前审计：

```bash
repo-guard dependencies
repo-guard enable dependencies
repo-guard doctor
```

默认规则包括：

- `dependencies`、`devDependencies`、`optionalDependencies` 使用精确 SemVer；`peerDependencies` 可保留兼容范围；
- 默认只批准普通 registry 版本、精确 `npm:` alias 和 `workspace:`；Git、HTTP、GitHub shorthand、本地路径等来源必须在 `allowedProtocols` 明确批准；
- 同一个包不得重复出现在多个非 peer 分组；peer 与开发依赖并存不视为冲突；
- 要求 lockfile v2+，并逐项核对根 `dependencies`、`devDependencies` 和 `optionalDependencies`；
- `bannedPackages` 可记录禁用包、至少 10 个字符的原因和可选替代包。

`requireExactVersions: false` 只关闭精确版本要求，不会关闭来源、分组、禁用包或锁文件治理。`allowedProtocols` 填协议名且不带冒号，例如显式批准 `file` 或 `git+https`；扩大来源属于策略变更，必须代码审查。该门禁不替代 `npm audit`、许可证扫描或供应链漏洞平台。

违规按 `dependencies/*` 规则 ID、文件、行、列精确匹配 `exceptions.entries`。例外必须遵守统一审批与到期机制；AI 不得自行登记例外、关闭开关、扩大协议列表或手工伪造 lockfile。

### 依赖架构门禁

repo-guard 使用业务项目本地安装的 dependency-cruiser，但统一拥有规则配置、执行顺序和报告格式。它兼容仅通过 ESM `import` 条件导出入口的 dependency-cruiser 16、17 和 18。它不会把架构检查塞进 ESLint 或 `pre-commit`；启用后在完整单元测试之后、生产构建之前执行全项目依赖图检查。

```bash
# Node.js 22.23.2+ 选择与项目兼容的 dependency-cruiser 版本
npm install --save-dev dependency-cruiser@^18
repo-guard enable architecture
repo-guard doctor
repo-guard architecture
```

新项目只有在已安装 dependency-cruiser 且 `sourcePaths` 可用时，`init` 才自动开启；已有配置迁移后保持关闭。`tsConfig: null` 会在根目录存在 `tsconfig.json` 时自动传给 dependency-cruiser，因此纯 JavaScript 项目无需手动关闭 TypeScript 选项。
dependency-cruiser 自身的 Node.js 要求随大版本变化；repo-guard 的可选 peer 范围是 `>=16 <19`，业务项目应选择与自身 Node.js 兼容的版本。

默认三条 error 规则禁止循环依赖、无法解析的导入以及生产代码导入测试代码。`rules` 使用 dependency-cruiser 的 `from`/`to` 条件；`error` 会阻止推送，`warn` 和 `info` 只进入统一报告，`ignore` 不执行。启用时还会在 `AGENTS.md` 增量维护与当前配置一致的 AI 架构要求。

架构错误会按编号输出可独立复制给 AI 的完整中文修复指令。每段包含项目根目录、规则名、依赖关系、完整循环链路、针对性修复建议、修改范围、禁止绕过要求，以及架构检查、测试和生产构建验证命令。dependency-cruiser 16 的字符串循环链路与 17/18 的对象循环链路都会格式化为可读路径。

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 检测到依赖和源码时新项目为 `true`；迁移后 `false` | 是否在受管理的 `pre-push` Hook 自动执行 |
| `timeoutMs` | `120000` | dependency-cruiser 最长运行时间 |
| `sourcePaths` | `["src"]` | 传给 dependency-cruiser 的仓库相对目录、文件或 glob |
| `tsConfig` | `null` | 自动使用根目录 `tsconfig.json`；也可指定仓库相对路径 |
| `exclude` | 构建、覆盖率、依赖和 Git 目录 | dependency-cruiser 排除正则；`null` 表示不注入排除项 |
| `rules` | 3 条 error 规则 | repo-guard 生成的 dependency-cruiser forbidden 规则 |

架构错误必须通过调整依赖方向、提取低层公共模块或修正导入来解决。禁止通过关闭门禁、降低 severity、缩小 `sourcePaths`、扩大 `exclude` 或修改规则绕过。

### JS/TS/Vue 单元测试门禁

repo-guard 负责测试策略、推送范围识别、覆盖率阈值判定和流程编排，测试框架、覆盖率 Provider、
运行环境、Mock 和具体用例仍由业务项目维护。纯 JavaScript 的 Vue 项目可以安装：

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
| `coverage.enabled` | `false` | 是否生成新报告并启用全局覆盖率及变更行覆盖率硬门禁 |
| `coverage.reportsDirectory` | `coverage` | `coverage-summary.json` 和 `lcov.info` 的项目相对目录 |
| `coverage.thresholds` | 全局四项 `80`、变更行 `90` | 行、语句、函数、分支及本次 Git 变更可执行行的最低百分比 |
| `componentInteraction.enabled` | `false` | 对交互型 Vue 组件启用挂载、真实交互和结果断言语义门禁 |
| `componentInteraction.componentPatterns` | `src/components/**/*.vue` | 需要识别模板交互入口的 Vue 组件 glob |
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

启用 `componentInteraction` 后，repo-guard 只对 `componentPatterns` 范围内且模板包含 `v-on`、
`@事件` 或 `v-model` 的 Vue 组件增加交互语义校验，纯展示组件不受影响。有效用例必须在同一个正常
执行的 `it/test` 中直接导入被测组件，使用 `@vue/test-utils` 的 `mount` 挂载，通过
`trigger`、`setValue`、`setChecked` 或 `setSelected` 模拟用户操作，并在交互之后断言 DOM、可见状态、
emit、Props、路由、Store 或 Mock 调用结果。仅检查组件已定义、`wrapper.exists()`、mount 不抛错、
快照或初始状态不算交互测试。

结构化覆盖率门禁启用后，repo-guard 会向 Vitest 强制传入 `json-summary`、`lcov`、报告目录、
源码 include 以及测试/排除路径 exclude。测试成功后统一读取新生成的报告：全局行、语句、函数、
分支分别判定；变更覆盖率依据本次推送的精确 Git diff，仅统计 LCOV 中可执行的新增或修改行。
目标源码完全没有 LCOV 记录时会直接失败，防止未导入文件逃逸；LCOV 中没有对应可执行条目的
注释、空行或类型声明不进入变更行分母。报告会列出每项比例、阈值、缺失文件和未覆盖的 `file:line`。
`init` 和 `doctor --fix` 会把当前 `reportsDirectory` 增量加入受管理 `.gitignore` 区块，避免报告污染
工作区；不会删除报告或覆盖项目已有忽略规则。由于 Vitest 默认会清理报告目录，目录最后一级名称
必须包含 `coverage`（例如 `coverage`、`reports/coverage`），禁止指向 `.`、`src` 等项目内容目录。

业务项目必须提供与 Vitest 兼容的覆盖率 Provider，例如：

```bash
npm install --save-dev @vitest/coverage-v8
```

旧配置中的 `coverage: true/false` 继续兼容：`true` 只追加 `--coverage`，不会自动启用 repo-guard
阈值判定。要使用硬门禁，应改为上方结构化对象。覆盖不足必须补充有效测试，不得通过降低阈值、
扩大 `exclusions`、排除生产源码或复用旧报告绕过。

自动开启或手动开启只需要控制开关，不需要再导入 repo-guard 配置：

```bash
repo-guard enable unitTest
repo-guard enable componentInteraction
repo-guard enable coverage
repo-guard doctor
```

`repo-guard enable coverage` 会同时启用 `unitTest`，因为覆盖率只能在完整单元测试执行后判定；
`repo-guard enable componentInteraction` 同样会启用 `unitTest`，但仍只运行一次测试脚本。单独执行
`disable coverage` 或 `disable componentInteraction` 不会关闭普通单元测试门禁；关闭 `unitTest` 会同步
关闭组件交互增强，避免留下无法执行的配置。

也可以在不改变开关的情况下显式运行同一套检查：

```bash
repo-guard unit-test
```

缺少测试时会列出源码路径、建议测试路径和全部允许位置，并输出可以直接交给 AI 的要求；测试失败时
保留 Vitest 原始输出，再明确要求修复代码或用例，禁止删除测试、降低必要断言或关闭门禁。

### axe 组件与 E2E 可访问性测试门禁

`accessibilityTest` 是独立的 pre-push 硬门禁，支持 Vue 组件测试和 Playwright/Cypress E2E。业务项目拥有测试框架、浏览器环境、页面启动和具体用例；repo-guard 负责验证测试不是空壳、执行项目脚本并统一输出 AI 修复要求。

支持直接使用 `vitest-axe`、`jest-axe`、`@axe-core/playwright`、`cypress-axe` 或 `axe-core`。项目应提供独立脚本，例如：

```json
{
  "scripts": {
    "test:a11y": "vitest run --project accessibility"
  }
}
```

每个匹配的测试文件都必须包含正常执行的 `test`/`it`、直接导入 axe 集成、实际 DOM 扫描和零违规断言。Playwright/axe-core 必须断言 `results.violations` 为空；Cypress 必须先 `cy.injectAxe()` 再 `cy.checkA11y()`。门禁拒绝 `.skip/.skipIf/.todo/.only`、`disableRules`、`exclude`、`withRules`、`withTags`、`runOnly`、`includedImpacts` 和 `enabled: false`，避免通过跳过规则、节点、标准标签或低影响违规制造假通过。

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | 完整 axe 设置的新项目为 `true`；迁移后 `false` | 是否在 pre-push 自动执行 |
| `script` | `test:a11y` | 业务项目的独立 axe 测试脚本 |
| `timeoutMs` | `180000` | 可访问性测试进程最长运行时间 |
| `testPatterns` | `.a11y.spec/test` 与 `accessibility/` 目录 | 必须静态验证并由脚本执行的测试文件 glob |

```bash
repo-guard enable accessibilityTest
repo-guard accessibility-test
repo-guard doctor --fix
```

启用时会增量维护 `AGENTS.md` 中的 axe 测试硬性要求。AI 应覆盖关键组件默认、交互、加载、空数据和错误状态，或关键页面与弹窗、菜单、表单校验等 E2E 状态。axe 自动化不能发现所有可访问性问题，键盘流程、焦点顺序和屏幕阅读器体验仍需交互测试与人工审查。

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
| `complexity.enabled` | Stylelint 就绪的新项目为 `true`；迁移后 `false` | 是否强制选择器与嵌套复杂度规则 |
| `complexity.maxCompoundSelectors` | `3` | 单个解析后选择器允许的最大复合选择器段数 |
| `complexity.maxNestingDepth` | `3` | 样式规则允许的最大嵌套深度 |
| `governance.enabled` | Stylelint 就绪的新项目为 `true`；迁移后 `false` | 是否启用选择器优先级与样式作用域治理 |
| `governance.maxSpecificity` | `0,3,0` | `ID,class,type` 格式的最大选择器权重 |
| `governance.maxIdSelectors` | `0` | 单个选择器允许的 ID 数量；默认禁止 ID 选择器 |
| `governance.disallowImportant` | `true` | 是否禁止 `!important` |
| `governance.allowedGlobalStylePatterns` | `src/styles/**` 等 | 允许承载显式全局样式的仓库相对 glob |

Stylelint 必须由业务项目自行安装和配置，支持 `>=16 <18`。除启用时由 repo-guard 强制执行的复杂度与治理规则外，repo-guard 只加载项目
本地的 Stylelint、插件、自定义语法和规则，不会内置其他规则预设、自动安装依赖、探测
CSS/SCSS/Less/Vue 语言组合或生成 `stylelint.config.*`。准备完成后可执行：

```bash
repo-guard enable stylelint
repo-guard enable styleComplexity
repo-guard enable styleGovernance
repo-guard doctor
repo-guard style-complexity
repo-guard style-governance
```

复杂度门禁由 repo-guard 强制执行 Stylelint 核心规则 `selector-max-compound-selectors` 和
`max-nesting-depth`，但复用项目解析后的 `customSyntax`，因此适用于项目已正确配置的 Vue、
SCSS 和 Less。项目同名规则、override、`.stylelintignore` 和源码 `stylelint-disable` 不会关闭这两条硬规则；
普通 Stylelint 规则仍完全遵循项目配置。专项命令始终执行，可在正式启用前审计全仓样式。

复杂度违规使用 `style/selector-max-compound-selectors` 或 `style/max-nesting-depth` 规则 ID，
按文件、行、列精确匹配结构化例外。AI 应通过语义化 class、拆分选择器或降低嵌套修复，不得新增
disable 注释、覆盖规则、扩大 ignore 或自行登记例外。

样式治理门禁强制执行 Stylelint 核心规则 `selector-max-specificity`、`selector-max-id` 和
`declaration-no-important`，并由 repo-guard 检查样式作用域。Vue 组件的 `<style>` 必须使用
`scoped` 或 `module`；局部样式不得通过 `:global()` 逃逸。普通 CSS/SCSS/Less 文件必须位于
`allowedGlobalStylePatterns` 中，或使用 `.module.css/.module.scss/.module.sass/.module.less`。
`src/App.vue` 默认允许承载应用级全局样式，但仍会执行选择器权重、ID 和 `!important` 规则。
这些规则与复杂度规则一样，不会被项目同名配置、`.stylelintignore` 或 disable 注释关闭；
违规使用 `style/selector-max-specificity`、`style/selector-max-id`、
`style/declaration-no-important` 和 `style/no-unexpected-global-style` 精确结构化例外规则 ID。

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
repo-guard install-ci --provider gitlab --profile policy
repo-guard doctor --ci
repo-guard ci --profile policy
repo-guard migrate
repo-guard exceptions
repo-guard dynamic-code
repo-guard unsafe-html
repo-guard target-blank
repo-guard form-labels
repo-guard image-alt
repo-guard accessibility-test
repo-guard enable eslint prettier stylelint styleComplexity styleGovernance maxFileLines filePlacement dependencies architecture typeCheck unitTest accessibilityTest coverage build ci
repo-guard disable filePlacement
repo-guard file-placement
repo-guard dependencies
repo-guard style-complexity
repo-guard build
repo-guard architecture
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

`doctor` 会检查 Node.js、配置、结构化例外及 AI 例外规范、硬性 Vue 表单 label、图片 alt、`v-html` 与 `target="_blank"` 门禁、依赖治理、Hook 版本、依赖架构和 AI 架构规范、TypeScript 和构建脚本、项目 Vitest 和测试脚本、AI 测试规范、Lighthouse CI、
Stylelint、ESLint、Prettier、单文件行数、文件归位门禁配置和通知设置。`enable`/`disable` 只修改指定功能的 `enabled` 字段，随后应运行
`doctor` 验证业务项目依赖和配置是否完整。

## 升级到 0.15.0

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@0.15.0
npx repo-guard doctor --fix
npx repo-guard doctor
```

0.15.0 新增 GitLab CI 远程门禁。升级不会自动修改已有 `.gitlab-ci.yml` 或开启 CI；先运行 `repo-guard install-ci --provider gitlab --profile policy --dry-run` 审查变更，再执行安装和 `repo-guard doctor --ci`。已有成熟 lint/test/build Job 的项目使用 `policy`，需要 repo-guard 统一编排时使用 `full`。

0.14.0 将最低运行环境从 Node.js 18.12.0 提升到 Node.js 22.23.2。升级前先将开发机、CI 和消费项目统一到最新 Node.js 22 LTS 补丁版本；`doctor` 会按包元数据中的同一版本约束进行诊断。

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

0.12.4 新增结构化 `unitTest.coverage` 门禁。启用后由 repo-guard 强制生成并解析 `json-summary`
和 `lcov`，同时阻断全局行/语句/函数/分支覆盖率及精确 Git 变更行覆盖率不足。旧布尔配置保持
原有只追加 `--coverage` 的行为，不会因升级自动启用新阈值；安装 Provider 后可执行
`repo-guard enable coverage` 显式转换并开启结构化门禁。

0.12.5 新增 `architecture` 配置、`repo-guard architecture` 显式命令、dependency-cruiser 统一报告和
受管理的 `AGENTS.md` 架构规范。已有配置迁移后保持关闭；安装 dependency-cruiser 并确认规则后执行
`repo-guard enable architecture`，再运行 `repo-guard doctor --fix`。

0.12.6 新增通用 `exceptions` 结构化例外登记表、`repo-guard exceptions` 只读报告和受管理的
`AGENTS.md` 例外策略。已有配置迁移后默认登记表为空；运行 `doctor --fix` 补齐策略。过期或未来日期
条目会阻断正常门禁，例外必须精确到规则、文件、行列，并具备独立审批、工单和有限期限。

0.12.7 新增始终启用的 Vue `v-html` 安全门禁和 `repo-guard unsafe-html` 全项目命令。门禁只扫描
Vue 根模板并跳过脚本、注释和插值字符串；未经批准的发现阻止提交，只有精确命中当前有效
`vue/no-v-html` 结构化例外的属性才会放行。该硬性要求不提供关闭开关。

0.12.8 新增始终启用的 Vue `target="_blank"` 安全门禁和 `repo-guard target-blank` 全项目命令。
静态或简单绑定字面量 `_blank` 必须具有可证明的 `noopener`、`noreferrer`；动态 `rel` 不会被视为安全。
只有精确命中当前有效 `vue/target-blank-security` 结构化例外的位置才会放行。

0.12.9 修复 dependency-cruiser 16、17 和 18 仅暴露 ESM `import` 入口时被误报为未安装的问题，
启用依赖架构门禁的 Node 18、20、22 及更高版本项目无需添加 CommonJS 兼容入口。

0.12.10 为依赖架构 error 违规增加可独立复制给 AI 的完整修复指令，并兼容 dependency-cruiser
17/18 的对象循环链路格式。

0.12.11 新增 `dependencyPolicy`、`repo-guard dependencies` 和暂存依赖治理门禁，覆盖精确版本、
批准来源、分组唯一、npm 锁文件同步和项目禁用包。新项目默认开启；已有配置迁移后保持关闭，可先运行
`repo-guard dependencies` 审计，再执行 `repo-guard enable dependencies`。

0.12.12 新增 `preCommit.stylelint.complexity` 和 `repo-guard style-complexity`，默认限制复合选择器段数
与样式嵌套深度为 3。Stylelint 就绪的新项目默认开启；已有配置迁移后保持关闭，可先专项审计再执行
`repo-guard enable styleComplexity`。硬规则不能被项目配置、ignore 或 disable 注释覆盖。

0.12.13 新增始终启用的 Vue 原生表单控件 label 门禁和 `repo-guard form-labels` 全项目命令。
`input`、`select`、`textarea` 必须具有静态 `for/id`、外层 `label`、非空 `aria-label` 或指向现有 id 的
`aria-labelledby`；`placeholder`、`title` 和不可证明的动态绑定不能绕过。精确例外规则为
`vue/form-control-label`。

0.12.14 新增始终启用的 Vue 原生图片 alt 门禁和 `repo-guard image-alt` 全项目命令。内容图片必须
提供可静态验证且符合用途的非空 alt；纯装饰图片必须同时使用空 alt 与静态 none/presentation 角色。
门禁拒绝泛化占位词、文件名、不可证明的动态值及冲突装饰语义；精确例外规则为 `vue/img-alt`。

0.13.0 新增 `accessibilityTest` 完整门禁体系、`repo-guard accessibility-test` 和 pre-push axe 测试。
门禁支持组件及 Playwright/Cypress E2E，验证受支持集成、真实扫描、零违规断言与测试脚本执行，并拒绝
禁用规则、排除节点、影响级别过滤及 skip/only/todo。已有项目迁移后保持关闭。

0.13.1 新增始终启用的动态代码执行门禁，覆盖 JavaScript、TypeScript、JSX、TSX 和 Vue 脚本中的
`eval` 与 `Function` 构造器，识别常见间接访问方式并提供精确结构化例外和面向 AI 的安全改写指令。

0.13.2 新增 `unitTest.componentInteraction` Vue 组件交互测试语义门禁，复用现有测试映射、Vitest
执行和覆盖率流程。交互型组件必须在同一用例中完成直接导入、mount、wrapper 交互和结果断言；已有
项目迁移后保持关闭，可执行 `repo-guard enable componentInteraction` 显式启用。

0.13.3 新增 `preCommit.stylelint.governance` 和 `repo-guard style-governance`，默认限制选择器权重为
`0,3,0`、禁止 ID 选择器与 `!important`，并要求 Vue 组件样式使用 `scoped/module`、普通样式文件
位于显式全局目录或采用 CSS Modules。Stylelint 就绪的新项目默认启用；已有项目迁移后保持关闭，
可执行 `repo-guard enable styleGovernance` 显式启用。
