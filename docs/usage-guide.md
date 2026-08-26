# @cxyi7/repo-guard 使用说明

本文集中说明 `@cxyi7/repo-guard` 的安装、初始化、配置、命令和各类门禁接入方式。项目定位与功能概览见 [README](../README.md)，完整结构与能力清单见 [项目结构与功能清单](project-structure-and-feature-inventory.md)。

- 当前版本：`1.21.0`
- Node.js：`>=22.23.2`
- 配置契约：`version: 1`
- 用户可见状态、警告、错误和修复说明：简体中文；纯英文和夹杂说明性英文的中文文案都会被仓库检查阻断

## 快速开始

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@1.21.0
npx repo-guard init
npx repo-guard doctor
```

`init` 会：

- 创建或补齐 `repo-guard.config.json`；
- 安装五个托管 Git Hook；
- 设置当前仓库的 `core.hooksPath=.githooks`；
- 维护 `.gitattributes`、`.gitignore` 和本地 `.env.config`；
- 根据消费项目已安装的工具和脚本决定重型门禁是否启用；
- 增量补充 `guard:*` npm scripts 和受管理的 `AGENTS.md` 策略块。

已有非托管 Hook 或其他 `core.hooksPath` 不会被覆盖。

## 固定执行顺序

### pre-commit

顺序由锁定 Execution Plan 固定，消费项目不能重排：

启用 `preCommit.fileHeader` 或 `preCommit.functionDocs` 后，对应内容会先在 `lint-staged` 的暂存快照中完成同步，再进入下列受保护 Execution Plan；它们不新增、不删除也不重排计划步骤。

```text
Stylelint fix
  → ESLint fix
  → Prettier
  → Stylelint read-only verify
  → ESLint read-only verify
  → Vue async-resource-cleanup（启用时阻断）
  → path-naming（启用时检查全部已跟踪路径）
  → dynamic-code
  → Vue v-html
  → Vue target=_blank
  → Vue form label
  → Vue image alt
  → maximum-file-lines
  → file-placement
  → dependency-policy（最终 Git 索引）
  → image-assets（启用时读取最终 Git 索引二进制内容）
  → code-placement（最终 Git 索引）
  → protected-files（最后执行）
```

TypeScript、Knip 全项目无效代码、单元测试、axe、项目架构、构建和 Lighthouse 不进入 pre-commit。

### pre-push

```text
commit-message
  → typecheck
  → dead-code
  → unused-image-assets
  → unit-test
  → accessibility-test
  → architecture
  → build
  → lighthouse
```

各步骤根据配置启用或跳过，并使用本次推送的精确变更范围。

`pre-push` 会在重型门禁开始时立即输出中文阶段提示，并实时转发 TypeScript、单元测试、axe 和构建脚本的输出；Knip 与架构检查会显示即时进度，同时保留结构化 JSON 供机器解析。实时输出经过路径与敏感信息脱敏，失败后仍返回结构化问题和退出码，不会让 `git push` 在长时间任务中无提示等待。

## 常用使用方式

### 初始化、迁移和诊断

```bash
repo-guard init
repo-guard install-hooks
repo-guard migrate
repo-guard doctor
repo-guard doctor --fix
repo-guard doctor --ci
```

`doctor --fix` 只修复 repo-guard 管理的配置、Hook、CI、忽略项、项目脚本和 AGENTS 策略块，不安装项目工具、不填写密钥、不修改业务代码。

托管文本的最新状态比较会统一 LF、CRLF 和 CR 后再判断，因此 Windows 的 `core.autocrlf` 不会让内容正确的 `AGENTS.md`、`.gitignore`、`.gitattributes` 或 GitLab CI 被误报为缺失或过期；除换行符外，其他空白和正文仍严格匹配。

### AGENTS.md 托管规范

repo-guard 将项目配置和固定硬门禁投影为 7 个职责区块：仓库与变更治理、暂存代码质量、源码安全与资源生命周期、目录与文件结构、依赖与仓库健康度、测试质量、构建/交付与外部门禁。每个可配置功能至少对应一条规范；同一主题的能力会合并到同一区块，避免按功能生成大量零散章节。

- `init`、`enable`、`disable`、`migrate`、`doctor --fix` 和非预览的 `install-ci` 会同步托管区块。
- 同步前会先校验全部当前 marker 和已知旧 marker，全部有效后才一次写入；marker 缺失、重复、倒置或嵌套时拒绝修改文件。
- marker 外的人工内容和先后顺序保持不变；已禁用功能的陈旧说明会被删除，旧的四类策略 marker 会迁移为当前分组。
- webhook、通知凭据和 `codePlacement.content` 等敏感值不会写入托管规范。
- Git Hook 不写 `AGENTS.md`。直接编辑配置后应运行 `repo-guard migrate` 或 `repo-guard doctor --fix`；CI 的 `repository.agent-policy` 只读门禁会阻断未同步内容。
- 托管规范没有独立的 `enabled` 开关，不能在保留功能门禁的同时关闭对应 AI 约束。

### 启用或关闭能力

```bash
repo-guard enable eslint prettier
repo-guard enable stylelint styleComplexity styleGovernance
repo-guard enable dependencies commitMessage architecture deadCode imageAssets
repo-guard enable typeCheck unitTest coverage
repo-guard enable componentInteraction accessibilityTest
repo-guard enable build lighthouse
repo-guard enable fileHeader functionDocs asyncResourceCleanup pathNaming imageAssets filePlacement maxFileLines codePlacement
repo-guard enable notification ci

repo-guard disable lighthouse
repo-guard disable notification
```

支持的功能名：

```text
stylelint
eslint
prettier
fileHeader
functionDocs
asyncResourceCleanup
pathNaming
imageAssets
styleComplexity
styleGovernance
maxFileLines
filePlacement
codePlacement
dependencies
commitMessage
architecture
deadCode
build
lighthouse
typeCheck
unitTest
accessibilityTest
componentInteraction
coverage
notification
ci
```

动态代码、Vue `v-html`、新窗口链接、表单 label 和图片 alt 是原生硬门禁，没有关闭开关。

### 配置 Commit 提交信息门禁

提交信息门禁默认关闭。启用后，本地 `commit-msg` 会在自动变更文件摘要定稿前校验人工提交内容；pre-push、CI policy/full 和 release-ready 会重新读取实际提交对象，校验本次 Git revision 范围，不能只靠跳过本地 Hook 绕过。

```bash
repo-guard enable commitMessage
```

```json
{
  "commitMessage": {
    "enabled": true,
    "types": ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore"],
    "requireScope": false,
    "allowedScopes": [],
    "headerMaxLength": 100,
    "breakingChange": {
      "allowed": true,
      "requireMarker": true,
      "requireFooter": true,
      "requireMajorVersionOnRelease": true
    },
    "merge": { "allowed": true },
    "revert": { "allowed": true },
    "fixup": {
      "allowLocal": true,
      "allowPush": false,
      "allowCi": false
    }
  }
}
```

普通提交使用 `type(scope)!: 简要说明`；`scope` 和 `!` 是否必需由配置决定。`allowedScopes` 为空表示不限制 scope，非空时只接受列出的值。标题长度按 Unicode 字符计数，不按 UTF-16 字节或代码单元计数。

不兼容变更默认必须同时使用标题 `!` 和正文 `BREAKING CHANGE: 迁移说明`。release-ready 发现提交范围包含不兼容变更时，会比较 Git 基准提交与目标提交中的 `package.json`，并要求 major 提升；未提交的工作区版本修改不能绕过校验。普通提交、pre-push 和日常 CI 不根据提交类型自动改版本。

Git 自动生成的 merge commit 在本地通过 `MERGE_HEAD` 还原待提交父节点、在已提交历史中通过父节点数量识别，普通标题以及 revert/cherry-pick 使用的 `MERGE_MSG` 不能伪装成 merge；revert 必须保留 Git 生成的 `Revert "..."` 标题和 `This reverts commit <sha>.` 正文。默认策略允许开发者在本地创建 `fixup!`/`squash!`，但 pre-push 和 CI 会阻断，要求先执行交互式 rebase/autosquash。只有业务仓库确认由 GitLab 在进入受保护分支前可靠 squash 时，才应评审后将 `allowPush` 调整为 `true`；最终 CI 仍建议保持 `allowCi: false`。

### 配置项目级无效代码门禁

无效代码门禁默认关闭，使用消费项目自己安装的 Knip 6.x 和 `knip.*` 配置；repo-guard 不内置业务入口、不替项目猜测工作区边界，也不会回退到自身的开发依赖。

```bash
npm install --save-dev --save-exact knip@6.31.0
repo-guard enable deadCode
repo-guard dead-code
```

```json
{
  "deadCode": {
    "enabled": true,
    "mode": "strict",
    "configFile": "knip.json",
    "baselineFile": ".repo-guard/knip-baseline.json",
    "timeoutMs": 180000,
    "production": false,
    "issueTypes": [
      "files",
      "dependencies",
      "unlisted",
      "binaries",
      "unresolved",
      "exports",
      "types"
    ],
    "treatConfigHintsAsErrors": true
  }
}
```

- `strict`：发现任意已启用类型的问题都直接阻断，适合新项目或已清零项目。
- `noRegression`：允许已经审核并登记的历史问题，但拒绝新增问题、陈旧条目和分支扩大基线，适合旧项目渐进治理。
- `issueTypes` 中的 `dependencies` 是统一策略类型，会同时启用并归一化 Knip 的 `dependencies`、`devDependencies` 和 `optionalPeerDependencies`，避免开发依赖漏检。
- Knip 配置提示始终作为配置错误处理，避免因入口、插件或工作区配置不完整而得到虚假的“无问题”结果。
- 检查按完整项目依赖图运行，因此只进入手动命令、可选 pre-push 和 CI full，不进入 pre-commit；局部未使用变量仍由消费项目 ESLint 负责。
- `production: true` 只分析 Knip 定义的生产范围；启用前应确认测试、脚本和开发依赖不属于当前治理目标。

旧项目第一次接入时使用基线模式：

```bash
repo-guard enable deadCode
# 将 deadCode.mode 改为 noRegression，并先完成 Knip 配置
npm run guard:dead-code-baseline-init
git add .repo-guard/knip-baseline.json
git commit -m "chore: 初始化无效代码基线"
npm run guard:dead-code
```

基线由问题类型、仓库相对路径、名称和命名空间生成 SHA-256 指纹，并记录重复数量。运行门禁时，当前 Knip 结果必须和基线完全同步：新增问题会阻断；问题修复后保留的陈旧条目也会阻断。确认只删除已解决债务后运行：

```bash
npm run guard:dead-code-baseline-prune
git diff -- .repo-guard/knip-baseline.json
git add .repo-guard/knip-baseline.json
```

`init` 拒绝覆盖现有文件；`prune` 拒绝接纳任何新增问题。pre-push 和 CI full 还会把当前基线与 Git 基准提交比较，阻止通过手工修改、重新生成或增加计数扩大历史债务；纯文件重命名会按 Git 重命名关系映射，不会制造新债务。基线必须位于仓库内、不得经过符号链接、必须由 Git 跟踪，`issueTypes` 变化后需要先清理真实问题并重新评审接入方案，不能用重建基线绕过检查。

### 配置暂存文件头

文件头默认关闭，可通过 `repo-guard enable fileHeader` 启用，再在 `repo-guard.config.json` 中调整作用范围：

```json
{
  "preCommit": {
    "fileHeader": {
      "enabled": true,
      "include": ["src/**", "scripts/**"],
      "exclude": ["src/generated/**", "src/vendor/**"],
      "extensions": [".vue", ".html", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".less", ".scss", ".sass"]
    }
  }
}
```

- `include` 和 `exclude` 都使用仓库相对 glob；`exclude` 优先，适合排除生成代码、第三方代码和无需托管的目录。
- `extensions` 是白名单，不能填写当前支持范围以外的扩展名。
- `.vue`、`.html` 使用 `<!-- ... -->`；脚本和样式文件使用 `/* ... */`。
- 脚本 shebang 和样式 `@charset` 等必须位于首行的声明会保留在文件头之前。
- `@Author`、`@Date` 取文件第一次新增到 Git 历史时的作者和提交时间；新文件在首次提交前使用当前 Git 提交身份和时间。
- `@LastEditor`、`@LastEditTime` 每次从当前 Git 提交身份和时间重建；手动修改这四个字段不会保留。
- `@Description` 由开发者维护。已有受管文件头会保留该字段；新文件先生成空值，不根据文件名主观猜测描述。
- 即使用户删除 `@Description` 或乱写 Git 字段，只要顶部注释仍包含 LastEditor/LastEditTime，或同时包含 Author/Date，也会识别为受管文件头并整体重建；普通许可证和只有单个 Author 的 JSDoc 不会被覆盖。
- 历史字段输出统一使用 `@LastEditor`，旧的 `@LastEditors` 会在下一次同步时归一化。
- 已跟踪文件若因浅克隆而无法追溯首次新增记录，会停止同步并提示先补全 Git 历史，避免写入错误作者和时间。
- 文件头同步只处理本次暂存文件，并继续由 `lint-staged` 隔离和恢复未暂存改动。

### 配置暂存函数文档

函数文档同步默认关闭，可通过 `repo-guard enable functionDocs` 启用：

```json
{
  "preCommit": {
    "functionDocs": {
      "enabled": true,
      "include": ["src/**"],
      "exclude": ["**/*.d.ts", "**/*.min.js", "**/generated/**", "**/*.spec.*", "**/*.test.*"],
      "extensions": [".vue", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]
    }
  }
}
```

- 仅处理本次暂存且同时命中 `include`、未命中 `exclude`、扩展名已启用的文件；默认排除声明文件、压缩产物、生成目录和测试文件。
- 使用 Babel AST 识别具名函数、类/对象方法、单变量绑定的箭头或函数实现，以及默认导出实现；匿名回调不会被自动补文档。
- 参数新增、删除或调序时同步 `@param`；有返回值时补齐 `@returns`，无返回值时删除陈旧返回标签。新标签只写参数名或标签名，不猜测“用户 ID”等业务说明。
- 保留人工维护的 `@Description`、标签说明和未托管标签；兼容 `@arg`/`@argument`、`@return` 和 `@exception` 别名。TypeScript 函数会移除 `@param`/`@returns` 中与签名重复的类型，但不改写说明。
- 函数存在直接逃逸的 `throw` 或返回的 `Promise.reject` 且缺少 `@throws`/`@exception` 时，只输出可定位的中文警告，不自动猜测异常说明，不阻断提交。
- 匿名解构参数不自动改写整个函数文档，而是给出提示；Generator 只同步参数，保留已有返回标签并提示人工维护 `@yields`。
- Vue 文件只解析顶层内联 `<script>` 和 `<script setup>`，跳过注释、template、style 和带 `src` 的外部 script。同步结果幂等，并继续由 `lint-staged` 保护部分暂存内容。

### 配置 Vue 异步资源清理

异步资源清理默认关闭，可通过 `repo-guard enable asyncResourceCleanup` 启用。启用后发现的问题全部按 `error` 阻断，不提供自动修复：

```json
{
  "preCommit": {
    "asyncResourceCleanup": {
      "enabled": true,
      "include": ["src/**/*.vue", "src/**/composables/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
      "exclude": ["**/*.d.ts", "**/*.spec.*", "**/*.test.*", "**/generated/**"],
      "extensions": [".vue", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
      "timeoutThresholdMs": 1000,
      "requestFunctions": ["fetch", "api.request"]
    }
  }
}
```

- 使用 Babel AST 按绑定身份匹配创建与释放，不用文本正则猜测；Vue 文件复用共享 script 扫描器，跳过 template、style、注释和外部 `src` script。
- 检查 `setInterval`、达到阈值或动态延迟的 `setTimeout`、已保存或递归的 `requestAnimationFrame`、事件监听器、Observer、WebSocket/EventSource/BroadcastChannel、Worker、订阅和定位监听。
- `addEventListener` 必须用相同目标、静态事件名、稳定回调和相同 `capture` 移除；`once: true` 可直接通过，`signal` 方式要求对应控制器在生命周期结束时 `abort()`。
- `requestFunctions` 中的请求必须传入可静态追踪的 `AbortController.signal`，并在卸载时 `abort()`；动态拼装且无法证明 signal 归属的写法会阻断。
- 支持 `onBeforeUnmount`、`onUnmounted`、`onScopeDispose`、Options API 卸载钩子和 Vue 2 销毁钩子；`onActivated` 中创建的资源必须在 `onDeactivated` 释放。清理可通过本地 helper 间接调用，但在 `await` 后才注册或执行的清理不算可靠。
- 短于阈值的定时器和 `new Promise(resolve => setTimeout(resolve, ...))` 延时写法不检查；同一句柄存在多个静态创建点时会额外报告覆盖风险。
- 可使用结构化例外临时批准精确规则、文件和位置；普通注释、disable 指令或项目 lint 配置不能关闭这项门禁。

### 配置统一路径命名

路径命名默认关闭，可通过 `repo-guard enable pathNaming` 启用。npm 包同时支持 `camelCase` 和 `kebab-case`，但一个消费项目只能配置一个字符串值，所有指定目录共用同一规范：

```json
{
  "preCommit": {
    "pathNaming": {
      "enabled": true,
      "convention": "camelCase",
      "include": ["src/**", "utils/**"],
      "exclude": ["**/.*", "**/.*/**", "**/generated/**"]
    }
  }
}
```

- `convention` 只能是 `camelCase` 或 `kebab-case`，不能填写数组，也不能为不同目录分别覆盖；业务项目启用后只有一种统一标准。
- 文件名和文件夹名使用同一规范。`camelCase` 接受 `committeeInfo`，`kebab-case` 接受 `committee-info`；全小写单词（如 `utils`）在两种规范下都合法。
- 文件扩展名不参与检查；多段文件名会逐段检查除最终扩展名外的名称，例如 `committeeInfo.service.ts` 和 `committee-info.service.ts` 分别符合对应规范。
- pre-commit、CI policy/full 和 release-ready 每次检查 Git 索引中的全部已跟踪路径，不只检查本次变更，因此启用前应先完成存量路径治理；新暂存路径也会立即进入检查，已删除路径不再阻断。
- `include`、`exclude` 使用仓库相对 glob，且 `exclude` 优先。默认排除隐藏路径和 `generated` 目录；`[id]`、`(auth)` 等框架特殊目录若需要保留，应明确加入排除范围。
- Git 不跟踪空目录，因此空目录只有在包含已跟踪文件后才会进入检查。门禁不会自动重命名，避免破坏 import、路由、脚本和大小写敏感文件系统中的引用关系。

### 配置图片资源治理与 WebP 转换

图片治理默认关闭，消费项目需自行安装兼容的 Sharp 和 SVGO，再显式启用：

```bash
npm install --save-dev --save-exact sharp@0.35.3 svgo@4.1.0
repo-guard enable imageAssets
repo-guard doctor
```

通过 `repo-guard enable imageAssets` 启用时会同步 `AGENTS.md` 托管区块，写入当前生效的命名、真实格式、重复、压缩范围以及 Hook/CI 只读约束；关闭功能会移除对应规则。若直接编辑配置，请运行 `repo-guard migrate` 或 `repo-guard doctor --fix` 完成同步，CI 只检查一致性，不会写入文件。

```json
{
  "imageAssets": {
    "enabled": true,
    "enforcement": "changedFiles",
    "include": ["src/assets/**/*.{png,jpg,jpeg,webp,avif,svg}"],
    "exclude": ["**/generated/**", "**/dist/**", "**/reports/**"],
    "extensions": ["png", "jpg", "jpeg", "webp", "avif", "svg"],
    "naming": {
      "enabled": true,
      "convention": "camelCase",
      "lowercaseExtension": true,
      "densitySuffixes": ["@2x", "@3x"],
      "allowNinePatch": false
    },
    "duplicates": {
      "exact": "error",
      "pixel": "off",
      "canonicalRoots": ["src/assets"]
    },
    "compression": {
      "enabled": true,
      "action": "report",
      "minInputBytes": 8192,
      "minSavingsBytes": 2048,
      "minSavingsPercent": 10,
      "raster": {
        "enabled": true,
        "allowLossy": false,
        "metadata": "preserve"
      },
      "svg": {
        "enabled": true,
        "allowWrite": false
      },
      "conversion": {
        "enabled": true,
        "target": "webp",
        "sourceFormats": ["png", "jpg", "jpeg"],
        "action": "report",
        "minInputBytes": 8192,
        "minSavingsBytes": 4096,
        "minSavingsPercent": 20,
        "pngMode": "lossless",
        "jpegQuality": 82,
        "effort": 6,
        "exactAlpha": true,
        "allowFallbackOriginal": false
      }
    },
    "limits": {
      "maxInputBytes": 26214400,
      "maxPixels": 40000000,
      "maxFrames": 1
    }
  }
}
```

- `changedFiles` 只阻止本次新增或修改产生的新问题，适合旧项目接入；`allFiles` 每次治理完整范围。精确重复使用 Git blob 标识或内容哈希，不依赖文件名；`canonicalRoots` 接受仓库内目录或 glob，并决定建议保留路径。增量模式优先保留未变更的存量资源，工具不会自动删除副本。
- `duplicates.pixel` 可设为 `report` 或 `error`，通过 Sharp 旋转归一、转换 sRGB 并解码静态像素后比较，能够发现 PNG/JPEG/WebP/AVIF 间的视觉重复；为保持 pre-commit 与 CI policy 轻量，该项只在手动、CI full 和 release-ready 执行。允许原图回退时，同目录同主名的原图/WebP 组合不会被当作像素重复。
- 压缩和 WebP 建议同时满足最小输入体积、最小节省字节数、最小节省比例才会报告。WebP 并不存在对所有 PNG 固定节省 70% 到 80% 的保证：照片、插画、透明图和已压缩素材差异很大，因此门禁只依据每个文件的真实候选结果判断。
- `compression.enabled` 是原格式压缩和 WebP 转换的统一父开关；关闭后即使保留 `conversion.enabled: true` 也不会运行转换分析或写入。像素重复属于独立检查，不受该父开关影响。
- PNG 默认只生成无损候选并复核像素一致性；JPEG/WebP 原格式压缩需先配置 `raster.allowLossy: true`。写入 JPEG/WebP 原格式压缩或 JPEG/有损 PNG 转 WebP 时，还必须传入 `--allow-lossy` 完成第二次确认；只读预览不会要求命令行确认。`metadata` 决定候选保留或移除元数据。
- SVGO 使用保守插件集合，并在接受候选前复核 `viewBox`、ID、类名、ARIA/role、引用、`url(#...)`、`title` 和 `desc`。SVG 写入还必须显式设置 `svg.allowWrite: true`。
- 图片命名与 `preCommit.pathNaming` 同时启用时必须使用同一种 `convention`；图片由 `imageAssets.naming` 检查，避免同一路径被两套规则重复报告。扩展名必须小写，倍率后缀只能使用配置白名单。
- Hook 与 CI 只读取最终暂存区或目标 revision，不读取未暂存副本，也绝不自动改图。输入体积、解码像素和帧数超过上限时停止分析并给出结构化问题，避免压缩炸弹和动画资源造成不可控消耗。

只预览真实收益：

```bash
repo-guard image-optimize -- src/assets/logo.png
repo-guard image-optimize --to webp -- src/assets/banner.jpg
```

显式写入：

```bash
repo-guard image-optimize --write -- src/assets/logo.png
repo-guard image-optimize --to webp --write --allow-lossy -- src/assets/banner.jpg
```

写入只接受范围内、由 Git 跟踪且没有暂存/未暂存修改的源文件，并拒绝路径任意层级的符号链接。原格式压缩使用不冲突的临时文件和备份完成安全替换，并保留原文件权限；WebP 转换只创建同目录同主名的 `.webp`，包括悬空符号链接在内的目标路径已存在就停止，原图和代码引用保持不变，必须由开发者完成视觉、浏览器/小程序兼容性和引用切换验证。

### 配置无效图片资源门禁

无效图片是指位于 `imageAssets.include` 范围内，但没有被配置范围源码静态引用、也没有被有效动态声明覆盖的图片。该能力默认关闭，不会进入 pre-commit；启用时同步打开父级图片治理：

```bash
repo-guard enable unusedImageAssets
repo-guard unused-image-assets
```

```json
{
  "imageAssets": {
    "enabled": true,
    "enforcement": "changedFiles",
    "unused": {
      "enabled": true,
      "action": "error",
      "sourceInclude": ["*.{html,md}", "src/**/*.{vue,nvue,html,wxml,js,jsx,ts,tsx,mjs,cjs,css,less,scss,sass,wxss,json}", "public/**/*.html", "docs/**/*.md"],
      "sourceExclude": ["**/*.spec.*", "**/*.test.*", "**/generated/**", "**/dist/**"],
      "sourceExtensions": [".vue", ".nvue", ".html", ".wxml", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".less", ".scss", ".sass", ".wxss", ".md", ".json"],
      "aliases": [{ "prefix": "@/", "directory": "src" }],
      "publicRoots": [{ "directory": "public", "urlPrefix": "/" }],
      "dynamicReferences": [
        {
          "sourcePatterns": ["src/pages/gallery.ts"],
          "assetPatterns": ["src/assets/runtime/*.png"],
          "reason": "接口只返回文件名，页面在受控目录内拼接图片路径"
        }
      ],
      "limits": {
        "maxSourceFiles": 10000,
        "maxSourceBytes": 2097152,
        "maxTotalSourceBytes": 104857600
      }
    }
  }
}
```

- 解析 JS/TS 的静态字符串、`new URL` 和 `import.meta.glob`，Vue/HTML/WXML 的 `src`、静态绑定、`srcset`、`poster`，CSS/Less/SCSS/Sass/WXSS 的 `url()`，以及明确纳入范围的 Markdown 和 JSON；远程 URL、`data:`、`blob:`、注释和动态模板不会被误计为使用。
- 相对路径以引用源码目录解析，别名与公开 URL 分别由 `aliases` 和 `publicRoots` 映射；查询参数和 hash 不参与文件匹配。路径必须留在仓库内，Git revision 源码通过单次批量对象读取并受文件数、单文件和总字节上限保护。
- 默认 `/assets/logo.png` 按 Vite 的 `public/assets/logo.png` 解析；uni-app 若把 `/static/logo.png` 实际存放在 `src/static/logo.png`，应将映射改为 `{ "directory": "src", "urlPrefix": "/" }`，并同步把 `src/static` 加入 `imageAssets.include`，避免把平台根路径误认为 `public` 路径。
- 运行时拼接无法静态证明时，必须配置 `dynamicReferences`。每项声明都要有原因，并同时匹配真实源码和图片；整个仓库通配、空匹配和已经失效的声明会作为配置错误处理。
- 手动命令始终审计当前工作区全量。`changedFiles` 在 pre-push、CI full 和 release-ready 中比较基线与当前 revision 的“未使用集合”，只阻止新增未引用图片或删除最后一处引用造成的新债务；`allFiles` 阻止全部存量。
- `action: "report"` 只报告警告，`error` 产生阻断错误。结构化例外仍需精确匹配 `assets/unused` 与图片路径。工具只提供证据，不自动删除图片或改写引用；删除前必须人工确认运行时、后端下发和平台约定路径。

### 配置变异测试与受保护构建

变异测试默认关闭，并且不会进入 pre-commit、pre-push 或固定 CI 计划。消费项目先按 [StrykerJS 官方初始化流程](https://stryker-mutator.io/docs/stryker-js/getting-started/)安装自身需要的 `@stryker-mutator/core` 10.x、测试运行器和 `stryker.config.*`；repo-guard 只调用消费项目的安装与配置，不内置测试运行器。

Stryker 的 `thresholds.break` 是必需的构建硬门槛，必须配置为 0 到 100 之间的数值；缺失时也会阻断构建。repo-guard 强制使用本地 `json`、`html`、`clear-text` 和 `progress` reporter，强制关闭 `inPlace`，不会启用 `dashboard` 或隐式上传报告。每次运行前都会删除旧报告，仅接受本次新生成且符合 Stryker `schemaVersion: "1.0"` 的报告。

```json
{
  "mutationTest": {
    "enabled": true,
    "configFile": "stryker.config.mjs",
    "timeoutMs": 1800000,
    "reportsDirectory": "reports/mutation",
    "originalHtml": true,
    "guardedBuilds": [
      {
        "script": "build:mp-weixin",
        "packageScript": "guard:build:mp-weixin",
        "timeoutMs": 300000,
        "notifyOnFailure": true
      },
      {
        "script": "build:h5",
        "packageScript": "guard:build:h5",
        "timeoutMs": 300000,
        "notifyOnFailure": true
      }
    ]
  }
}
```

运行 `repo-guard init` 后，repo-guard 会在别名不存在时加入以下脚本，并把报告目录加入受管 `.gitignore`：

```json
{
  "scripts": {
    "guard:mutation-test": "repo-guard mutation-test",
    "guard:build:mp-weixin": "repo-guard guarded-build build:mp-weixin",
    "guard:build:h5": "repo-guard guarded-build build:h5"
  }
}
```

`guardedBuilds` 可声明任意多个原始 npm 构建脚本，不限于小程序。受保护别名先执行完整变异测试；得分低于 `thresholds.break`、没有可评分变异、Stryker 执行失败、报告缺失或报告无效时都不会运行原始构建。通过后才执行对应的 `script`。原始 `build:*` 脚本保持不变并仍可直接调用，因此团队和 CI 必须改用 `guard:build:*` 才能获得强制保护；`repo-guard doctor` 会检查原始脚本和别名是否完整且未被替换。

报告默认写入 `reports/mutation/mutation.json`、中文 `mutation.html` 和可选的 Stryker 原始 `mutation-original.html`。路径必须位于 `reports/`、被 Git 忽略、不得穿过符号链接，也不得覆盖已跟踪文件。`notifyOnFailure` 与全局 `notification.enabled` 同时开启时，失败会复用现有企业微信配置发送项目、分支、构建脚本、得分、门槛和报告位置；GitLab 受管流水线通知已开启时不会重复发送。

保护文件检查：

```bash
repo-guard check
repo-guard gate
repo-guard dry-run
repo-guard gate --force-notify
```

### 配置指定代码允许位置

`codePlacement` 使用精确文本匹配。pre-commit 检查格式化完成后的最终 Git 索引，未暂存内容不会误阻断本次提交。

```json
{
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
        "scanPatterns": ["src/**/*.{js,jsx,ts,tsx,vue}"]
      }
    ]
  }
}
```

匹配时只统一 CRLF/CR 为 LF，不忽略其他空白，也不把语义相近但文本不同的代码视为相同。

### 配置不可变文件

使用精确仓库相对路径和 `level: "block"`：

```json
{
  "rules": [
    {
      "pattern": "src/security/permission-map.ts",
      "category": "不可变安全文件",
      "level": "block"
    }
  ],
  "exclusions": []
}
```

修改、删除、重命名或移动该文件都会阻断提交和 CI。规则按数组顺序采用第一条匹配，精确 `block` 规则应放在可能覆盖它的宽泛规则之前；`exclusions` 优先于规则。

### 企业微信通知

`init` 会创建被 Git 忽略的 `.env.config`：

```dotenv
REPO_GUARD_WECOM_WEBHOOK=
REPO_GUARD_MENTION_MOBILES=
```

系统环境变量优先于文件值。CI 不读取本地通知凭据，也不发送保护文件通知。

### GitLab CI

安装或检查 CI：

```bash
repo-guard install-ci --provider gitlab --profile policy --dry-run
repo-guard install-ci --provider gitlab --profile policy
repo-guard doctor --ci
```

显式执行：

```bash
repo-guard ci --profile policy --base <sha> --head <sha>
repo-guard ci --profile full --base <sha> --head <sha>
repo-guard ci --profile release-ready --base <sha> --head <sha>
```

| 配置档 | 内容 |
|---|---|
| `policy` | 原生安全、Vue 可访问性、结构化例外、依赖、文件/代码位置、行数、测试策略和保护文件 |
| `full` | `policy` 加只读 Stylelint、ESLint、Prettier、类型检查、完整单元测试/覆盖率、axe、架构和构建 |
| `release-ready` | `policy` 加项目 `check`、项目 `test`、构建、可选 Lighthouse 和发布包一致性检查 |

CI 门禁始终只读，不执行 fix、不安装 Hook、不读取本地企业微信凭据。只有显式启用的托管流水线通知会读取 GitLab CI 受保护变量并发送结果。

#### CI 门禁策略

`ci.gatePolicy` 只控制 `repo-guard ci` 使用的 `ci-policy`、`ci-full` 和 `release-ready` 环境，不会被 pre-commit 或 pre-push 读取。同一个 Gate 可以在提交时强制执行、在 CI 中关闭，也可以在提交时关闭、仅在 CI 中报告或强制执行。

```json
{
  "ci": {
    "enabled": true,
    "profile": "policy",
    "reportPath": "reports/repo-guard.json",
    "protectedFiles": { "action": "report" },
    "gatePolicy": {
      "defaultMode": "inherit",
      "gates": {
        "security.dynamic-code": {
          "mode": "enforce",
          "scope": "changed-files"
        },
        "accessibility.vue-image-alt": {
          "mode": "report"
        },
        "repository.maximum-file-lines": {
          "mode": "off"
        }
      }
    }
  }
}
```

| 模式 | CI 行为 |
|---|---|
| `inherit` | 保持 1.7.0 之前的兼容行为：沿用 Gate 原有 `enabled` 配置，失败会阻断 CI |
| `off` | 在 setup 和执行之前跳过该 CI Gate，不阻断 CI |
| `report` | 仅在隔离的 CI 上下文中启用并执行，失败写入步骤报告但不阻断 CI |
| `enforce` | 仅在隔离的 CI 上下文中启用并执行，失败阻断 CI |

`scope` 默认为 `all-files`。只有 Registry 明确声明支持文件范围的 Gate 才能使用 `changed-files`；不支持的组合会作为配置错误失败，而不是静默缩小检查范围。

CI Gate 由 Registry 的 CI environment 元数据自动发现，配置 Schema 使用稳定 Gate id 的通用键约束，不维护容易遗漏的手写 Gate 枚举。仓库测试还要求每个官方 CI Gate 至少属于一个受审固定执行计划；因此未来新增 CI Gate 时，如果忘记进入执行计划，发布检查会直接失败，而进入计划后会自动获得 `inherit/off/report/enforce` 策略能力。

### 托管应用交付流水线

`1.8.0` 在原有 `install-ci` 受管 include 上增加可选的应用交付标准，不引入另一套 CI 安装方式。npm 包负责生成和校验 GitLab Job、分支规则、阶段、Node 环境、npm 缓存、依赖安装、门禁先行以及手动发布语义；消费项目继续拥有实际构建、上传和部署实现。

消费项目只需实现固定的 npm scripts：

| script | 何时需要 | 项目职责 |
|---|---|---|
| `ci:verify` | 始终 | 对非交付分支执行项目自己的构建或验证 |
| `ci:deploy:test` | 始终 | 发布测试环境；可读取 `CI_COMMIT_BRANCH` 区分 `dev`、`test` 或 `future/*` |
| `ci:deploy:production` | 配置了生产分支时 | 执行人工确认后的生产发布 |
| `ci:deploy:quick` | `quickDeploy: true` | 执行任意分支的人工快速发布 |

示例配置：

```json
{
  "ci": {
    "enabled": true,
    "profile": "policy",
    "pipeline": {
      "enabled": true,
      "verifyStage": "build",
      "deployStage": "deploy",
      "verifyImage": "node:22.23.2",
      "deployImage": "node:22.23.2",
      "testBranches": ["dev", "future/*"],
      "productionBranches": ["publish"],
      "runnerTags": ["docker"],
      "legacyPeerDeps": true,
      "quickDeploy": true,
      "notifications": true
    }
  }
}
```

配置并补齐 scripts 后运行：

```bash
repo-guard install-ci --provider gitlab --profile policy --dry-run
repo-guard install-ci --provider gitlab --profile policy
repo-guard doctor --ci
```

当 `notifications: true` 时，生成器会在 GitLab 保留的 `.post` 末尾阶段增加两个互斥的通知 Job：`repo_guard_notify_success` 使用 `when: on_success`，`repo_guard_notify_failure` 使用 `when: on_failure`。GitLab 根据此前所有阶段的最终结果只执行其中一个，因此整条流水线只发送一条成功或失败通知；任何会阻断流水线的 Job 失败都会进入失败通知。受管 Job 在运行中被手动取消，或前置门禁/验证 Job 被 GitLab 自动取消时，`after_script` 会发送“已取消（canceled）”通知。业务项目不再需要提供 `ci:notify` script。

通知内容包含项目、流水线编号、分支、提交、提交人和流水线链接。提交标题最多显示前 10 个字符，更长时追加省略号。两个末尾通知 Job 都设置 `allow_failure: true`，因此企业微信暂时不可用不会篡改原流水线结果；GitLab 原本标记为 `allow_failure: true` 的非阻断 Job 也继续按成功处理。

在 GitLab 的 CI/CD Variables 中配置：

| 变量 | 要求 | 用途 |
|---|---|---|
| `REPO_GUARD_WECOM_WEBHOOK` | 必需，建议设为 Masked 与 Protected | 企业微信群机器人 Webhook；只接受官方 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...` 地址 |
| `REPO_GUARD_MENTION_MOBILES` | 可选，建议设为 Masked 与 Protected | 逗号分隔的 11 位手机号；未配置时只发消息、不 @ 成员 |

通知命令只允许在 `GITLAB_CI=true` 且带有受管通知标记的生成 Job 中执行。成功、失败和取消入口分别向包内命令传入受控的 `success`、`failed` 或 `canceled` 状态，不会重新加载可能已经导致流水线失败的项目配置。通知包会在 `$CI_BUILDS_DIR` 下按项目、流水线和 Job 组成的唯一目录中，从 npm 官方 tarball URL 精确安装生成流水线时对应版本的 `@cxyi7/repo-guard`；安装时禁用 lifecycle scripts，执行时使用隔离目录中的绝对 CLI 路径，不会解析消费项目的本地可执行文件。因此配置错误或前序 Job 的项目 `npm ci` 失败不会连带阻止末尾通知。

GitLab 只会在运行中的 Job 被取消时执行 `after_script`。因此，取消通知覆盖手动或自动取消时正在运行的 repo-guard 受管 Job；如果 Job 尚未开始就在 pending 状态被取消，或使用 GitLab 强制取消跳过 `after_script`，则 Runner 没有可执行的通知入口。

启用后，`repo_guard` 固定在 GitLab 的 `.pre` stage 覆盖分支和合并请求流水线，确保受管验证与发布 Job 在门禁通过后才执行；测试发布自动执行，生产与快速发布保持手动，其中快速发布允许失败。验证作业会跳过已由测试或生产发布脚本负责构建的分支，避免重复构建。`verifyImage` 和 `deployImage` 分别控制验证与发布容器，二者都必须包含 Node.js 与 npm；Web 容器发布可以把 `deployImage` 指向项目内部维护的 Node.js + Docker CLI 镜像。`install-ci` 与 `doctor --ci` 会拒绝缺少固定 scripts、阶段未声明、保留 Job 名冲突、模板被改写或模板版本不匹配等状态。

三个现有项目建议采用同一个外壳：`owner` 与 `employee` 的 `ci:deploy:*` 继续调用各自的 `mp-ci-deploy.js`；`front` 的 `ci:deploy:test` 根据分支调用其 Web 构建、镜像和蓝绿部署脚本。镜像仓库、端口、微信小程序机器人和密钥仍由项目脚本持有；通知 Webhook 只放在 GitLab 受保护变量中，不进入 repo-guard 配置。

### 外部门禁

消费项目可以通过严格的 npm script 和 `repo-guard-json-v1` 报告接入项目自有检查：

```json
{
  "externalGates": [
    {
      "id": "project.api-contract",
      "enabled": true,
      "environments": ["manual", "ci-full", "release-ready"],
      "script": "test:api-contract",
      "timeoutMs": 120000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/api-contract.json"
      }
    }
  ]
}
```

```bash
repo-guard external project.api-contract
```

外部门禁不进入 pre-commit、pre-push 或 CI policy，也不能插入或重排官方计划。它们仍然只在可信的 GitLab 受保护分支环境中运行；`ci.gatePolicy` 不会绕过该安全限制。

### Axios 手动接口性能外部门禁

`1.14.0` 提供外部门禁专用的 Axios 性能 runner。它不是官方 Gate，不进入 Registry 固定计划；只有消费项目显式执行 `repo-guard external project.api-performance` 时，现有外部门禁才会调用项目精确 npm script。runner 同时要求 `environments` 只能是 `["manual"]`，并拒绝在带有常见 CI、GitLab CI、GitHub Actions、Azure Pipelines 或 Jenkins 环境标记的进程中运行。

消费项目配置：

```json
{
  "externalGates": [
    {
      "id": "project.api-performance",
      "enabled": true,
      "environments": ["manual"],
      "script": "test:api-performance:runner",
      "timeoutMs": 300000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/api-performance/axios-gate.json"
      }
    }
  ]
}
```

```json
{
  "scripts": {
    "test:api-performance:runner": "repo-guard api-performance-runner --gate-id project.api-performance --config test/performance/api-performance.config.json",
    "guard:api-performance": "repo-guard external project.api-performance"
  }
}
```

`test/performance/api-performance.config.json`：

```json
{
  "$schema": "../../node_modules/@cxyi7/repo-guard/api-performance-config.schema.json",
  "target": {
    "baseUrlEnv": "REPO_GUARD_PERF_BASE_URL",
    "allowedHosts": ["api-test.example.com"],
    "confirmationEnv": "REPO_GUARD_PERF_CONFIRM_HOST"
  },
  "client": {
    "module": "test/performance/axios-client.mjs"
  },
  "scenarios": [
    "test/performance/scenarios/current-user.perf.mjs"
  ],
  "execution": {
    "warmupIterations": 2,
    "iterations": 20,
    "concurrency": 1
  },
  "thresholds": {
    "p95Ms": 500,
    "p99Ms": 1000,
    "errorRate": 0
  },
  "safety": {
    "allowWrites": false
  }
}
```

项目提供 Node.js 可加载的客户端工厂，以复用业务 Axios 工厂、拦截器、Token 注入和错误处理；repo-guard 不安装第二份 Axios，也不修改生产实例：

```js
import { createRequestClient } from '../../src/api/request-factory.js';

export function createPerformanceClient({ baseURL }) {
  return createRequestClient({
    baseURL,
    getToken: () => process.env.REPO_GUARD_PERF_TOKEN,
  });
}
```

场景模块只提供稳定标签和真实调用，标签不得包含查询参数或凭据：

```js
export default {
  name: '查询当前用户',
  method: 'GET',
  pathLabel: '/user/current',
  async run({ client }) {
    await client.get('/user/current');
  },
};
```

执行前必须显式确认目标：

```powershell
$env:REPO_GUARD_PERF_BASE_URL = 'https://api-test.example.com/'
$env:REPO_GUARD_PERF_CONFIRM_HOST = 'api-test.example.com'
$env:REPO_GUARD_PERF_TOKEN = '<仅用于测试环境的临时凭据>'
npm run guard:api-performance
```

runner 只接受 HTTPS、精确主机白名单和本次确认值。默认只允许 `GET`、`HEAD`、`OPTIONS`；`POST`、`PUT`、`PATCH`、`DELETE` 必须同时启用全局 `safety.allowWrites`、场景 `allowWrites: true` 并提供 `cleanup`。清理失败、预热失败、配置错误或报告错误使用退出码 `1` 且不生成主报告；阈值不满足生成 `violation` 报告并使用退出码 `2`；通过使用退出码 `0`。报告目录必须被 `.gitignore` 忽略，最终生成协议 JSON 和 `axios-report.html` 中文报告，二者仍由通用外部门禁执行新鲜度、路径、Git 跟踪状态和敏感信息复检。

### k6 手动接口压测外部门禁

`1.15.0` 新增使用消费项目本机 k6 二进制的并发压测 runner。它与 Axios 性能 runner 互补：Axios runner 验证业务客户端、拦截器和低并发真实调用链；k6 runner 验证服务在受控并发或恒定到达率下的延迟、错误率、检查成功率和丢弃迭代。k6 不是 Node.js 运行时，不能直接加载 Axios 客户端；本功能不修改业务 Axios 实例，也不进入提交、推送、CI、发布、受保护构建或打包流程。

先按 [k6 官方安装说明](https://grafana.com/docs/k6/latest/set-up/install-k6/) 安装本机 k6。当前支持 k6 `1.5.0` 至 `2.x`，不自动安装扩展、不使用 Docker、不调用 k6 cloud，也不上传结果。

消费项目声明 manual-only 外部门禁和两个显式 npm script：

```json
{
  "externalGates": [
    {
      "id": "project.k6-load",
      "enabled": true,
      "environments": ["manual"],
      "script": "test:k6:runner",
      "timeoutMs": 900000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/k6/k6-gate.json"
      }
    }
  ]
}
```

```json
{
  "scripts": {
    "test:k6:runner": "repo-guard k6-runner --gate-id project.k6-load --config test/performance/k6-load.config.json",
    "guard:k6": "repo-guard external project.k6-load"
  }
}
```

`test/performance/k6-load.config.json` 的负载、阈值和目标都由纯 JSON 配置控制。下面示例的确认值必须精确包含“主机、配置档、执行器、最大 VU、总阶段时长和只读模式”：

```json
{
  "$schema": "../../node_modules/@cxyi7/repo-guard/k6-load-config.schema.json",
  "target": {
    "baseUrlEnv": "REPO_GUARD_K6_BASE_URL",
    "allowedHosts": ["api-test.example.com"],
    "confirmationEnv": "REPO_GUARD_K6_CONFIRM",
    "requireHttps": true
  },
  "script": "test/performance/scenarios/read.k6.js",
  "profile": {
    "name": "smoke-read",
    "executor": "ramping-vus",
    "startVUs": 0,
    "stages": [
      { "duration": "30s", "target": 5 },
      { "duration": "1m", "target": 20 },
      { "duration": "30s", "target": 0 }
    ],
    "gracefulRampDown": "30s",
    "gracefulStop": "30s"
  },
  "thresholds": {
    "p95Ms": 500,
    "p99Ms": 1000,
    "errorRate": 0.01,
    "checkRate": 0.99,
    "maxDroppedIterations": 0
  },
  "environment": {
    "pass": ["REPO_GUARD_K6_TEST_TOKEN"]
  },
  "safety": {
    "allowWrites": false
  }
}
```

场景必须默认导出函数、直接从 `__ENV` 读取受控基础地址，并至少产生一次 HTTP 请求和一次 `check`：

```js
import http from 'k6/http';
import { check } from 'k6';

const baseURL = __ENV.REPO_GUARD_K6_BASE_URL;

export default function readScenario() {
  const response = http.get(`${baseURL}/health`, {
    headers: { Authorization: `Bearer ${__ENV.REPO_GUARD_K6_TEST_TOKEN}` },
  });
  check(response, { '状态码为 200': (value) => value.status === 200 });
}
```

```powershell
$env:REPO_GUARD_K6_BASE_URL = 'https://api-test.example.com/'
$env:REPO_GUARD_K6_CONFIRM = 'api-test.example.com:smoke-read:ramping-vus:20vus:120s:readonly'
$env:REPO_GUARD_K6_TEST_TOKEN = '<仅用于测试环境的临时凭据>'
npm run guard:k6
```

受控入口会覆盖消费者脚本的 `options` 和 `handleSummary`，所以场景不得导出这两个名称。所有阈值与报告指标都绑定当前 `scenario`，只统计正式压测迭代，不让 `setup`/`teardown` 的登录、造数和清理请求污染 p95、p99、错误率、检查率或请求量。为保留这些场景子指标，runner 不启用 k6 可选的新机器摘要格式，而是校验受控 `handleSummary` 写出的聚合指标对象。入口关闭 k6 使用情况上报和自动扩展解析，先运行 `k6 inspect`，再运行本地 `k6 run`；子进程只接收操作系统启动所需变量、`environment.pass` 白名单、基础地址和本次随机 `runId`。脚本只能导入仓库内相对模块和 k6 内置模块，不得使用远程模块、`k6/x/*`、硬编码 HTTP 地址、动态请求方法或转存 `k6/http` 绑定。

默认仅允许 `GET`、`HEAD` 和 `OPTIONS`。启用 `safety.allowWrites` 后，脚本必须包含可静态识别的写方法、导出 `teardown`，并在 teardown 中使用 `__ENV.REPO_GUARD_K6_RUN_ID` 发出可静态验证的直接清理请求；进程被强制终止时 teardown 仍无法保证执行，因此写压测还必须使用测试账号、幂等或可过期数据，并由服务端提供兜底清理。`externalGates.timeoutMs` 至少覆盖负载时长、`gracefulStop`、setup、teardown 和 30 秒进程余量。

通过时退出码为 `0`；k6 阈值失败的原始退出码必须为 `99`，runner 生成 `violation` 后对外返回 `2`；其他退出码、超时、报告缺失或判定不一致均返回 `1`，且不生成可误用的主报告。报告目录必须位于已忽略、未跟踪且不穿过符号链接的 `reports/`，成功执行会保留 k6 机器摘要 `k6-summary.json`、中文 `k6-report.html` 和外部门禁 JSON；报告不会保存配置中的凭据。

维护者可显式设置 `REPO_GUARD_REAL_K6_BIN` 为本机官方 `k6` 可执行文件路径，再运行 `node --test test/k6-load.test.js`。该可选集成测试只对 k6 官方演示站点执行 1 VU、1 秒负载；常规 `npm test` 会跳过它，不会隐式联网或产生压测流量。

### 配置构建产物预算

产物预算是现有 `build` 门禁的可选后置阶段。一个业务项目只能选择一种平台：PC 项目配置 `pc`，小程序项目配置 `miniProgram`，不能同时存在。未启用 `artifactBudget` 时，原有构建行为不变。

PC/Vite 项目示例：

```json
{
  "build": {
    "enabled": true,
    "script": "build",
    "timeoutMs": 300000,
    "artifactBudget": {
      "enabled": true,
      "platform": "pc",
      "outputDirectory": "dist",
      "cleanScript": "clean:dist",
      "action": "error",
      "mode": "strict",
      "pc": {
        "analyzer": "viteManifest",
        "manifest": ".vite/manifest.json",
        "sourceMaps": "forbid",
        "compression": ["raw", "gzip", "brotli"],
        "limits": {
          "totalRawBytes": 8388608,
          "initialJsBrotliBytes": 358400,
          "initialCssBrotliBytes": 153600,
          "maxChunkRawBytes": 614400,
          "maxChunkCount": 80,
          "maxAssetRawBytes": 2097152
        }
      }
    }
  }
}
```

`viteManifest` 从生产产物中的 manifest 查找 `isEntry=true` 入口，并递归统计静态 `imports` 及关联 CSS/资源；动态导入不计入首屏。`directory` 适用于非 Vite 构建，只能使用全目录、分块和资源指标，配置首屏指标会直接报配置错误。只有 `compression` 中启用的算法才能对应配置压缩体积限制。

微信小程序示例：

```json
{
  "build": {
    "enabled": true,
    "script": "build:mp-weixin",
    "timeoutMs": 300000,
    "artifactBudget": {
      "enabled": true,
      "platform": "miniProgram",
      "outputDirectory": "unpackage/dist/build/mp-weixin",
      "action": "error",
      "mode": "strict",
      "miniProgram": {
        "provider": "weixin",
        "appConfig": "app.json",
        "limits": {
          "mainPackageBytes": 2097152,
          "defaultSubPackageBytes": 2097152,
          "totalPackageBytes": 20971520,
          "maxSingleFileBytes": 524288,
          "maxPreloadBytes": 4194304
        },
        "subPackages": [
          { "root": "pagesA", "maxBytes": 1572864 },
          { "root": "pagesB", "maxBytes": 1835008 }
        ],
        "expectedSubPackages": ["pagesA", "pagesB"],
        "exclusions": [
          {
            "patterns": ["project.private.config.json"],
            "reason": "微信开发者工具本机配置"
          }
        ]
      }
    }
  }
}
```

小程序分析读取构建后的 `app.json`，兼容 `subPackages`/`subpackages`，每个文件按 root 前缀唯一归入一个分包，其他文件归入主包；重复、嵌套或越界 root 会阻断。独立分包仍单独计量。`preloadRule` 引用不存在的分包或 `packages` 结构错误会阻断，`maxPreloadBytes` 按单条规则可能加载的主包/分包体积计算。`exclusions` 只允许微信开发者工具确定不上传的 `.DS_Store`、`project.config.json` 和 `project.private.config.json`，不能用 glob 排除业务产物。平台体积值可能变化，因此 repo-guard 不在运行代码中永久写死数值，项目需要依据当前发布平台规则显式配置；小程序固定为 `action=error`、`mode=strict`，不能降级。

产物目录必须在仓库内部，不得为根目录或 `src`，不得包含符号链接或 Git 已跟踪文件。`scanLimits.maxFiles`、`scanLimits.maxTotalBytes` 与 `scanLimits.maxCompressionInputBytes` 防止异常产物耗尽扫描和压缩资源。若配置 `cleanScript`，repo-guard 会先运行该精确 npm 脚本并验证其清除旧产物；未配置时，实际构建必须清除旧产物探针。repo-guard 只删除本次运行创建的探针，不会递归删除业务目录；若产物中已存在同名探针文件，门禁会拒绝运行并保留原文件。

PC 旧项目可以使用 `mode: "baseline"` 接受当前超限债务：先按相同配置完成一次生产构建，再执行：

```bash
repo-guard build-artifact-baseline init
git add .repo-guard/build-artifact-baseline.json
```

基线必须被 Git 跟踪并与当前平台、产物目录和 PC 预算配置指纹一致。新增问题或指标增长仍会阻断；债务下降后执行 `repo-guard build-artifact-baseline prune`，命令只能降低数值或删除已解决项，拒绝新增和扩大允许值。`action: "report"` 可用于 PC 试运行并以 warning 报告，但不能用于小程序平台硬限制。

### 手动运行专项门禁

```bash
repo-guard exceptions
repo-guard dependencies
repo-guard dynamic-code
repo-guard async-resource-cleanup
repo-guard path-naming
repo-guard unsafe-html
repo-guard target-blank
repo-guard form-labels
repo-guard image-alt
repo-guard image-assets
repo-guard unused-image-assets
repo-guard file-placement
repo-guard code-placement
repo-guard style-complexity
repo-guard style-governance
repo-guard typecheck
repo-guard unit-test
repo-guard mutation-test
repo-guard accessibility-test
repo-guard architecture
repo-guard dead-code
repo-guard build
repo-guard lighthouse
repo-guard lighthouse --skip-build
```

## 配置与结果

完整配置字段以 [config.schema.json](../config.schema.json) 为准。主要顶层配置包括：

```text
notification
ci
externalGates
codePlacement
exceptions
dependencyPolicy
commitMessage
deadCode
imageAssets
architecture
build
lighthouse
typeCheck
accessibilityTest
unitTest
mutationTest
preCommit
rules
exclusions
```

统一结果 Schema：

- [gate-result.schema.json](../gate-result.schema.json)
- [external-report.schema.json](../external-report.schema.json)
- [api-performance-config.schema.json](../api-performance-config.schema.json)
- [k6-load-config.schema.json](../k6-load-config.schema.json)

退出码：

| 退出码 | 含义 |
|---:|---|
| `0` | 通过或明确跳过 |
| `1` | 配置错误或执行错误 |
| `2` | 策略违规 |
| `3` | Git/CI 变更范围不可信 |

所有 repo-guard 自有错误都应说明问题位置、原因、预期状态和解决方式。第三方原始输出只进入经过脱敏和长度限制的 diagnostics，或作为经过脱敏的 `pre-push` 实时进度输出。

## 相关文档

- [项目概览](../README.md)
- [项目结构与功能清单](project-structure-and-feature-inventory.md)
- [版本记录](../CHANGELOG.md)
- [发布流程](../PUBLISHING.md)
