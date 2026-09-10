# Repository instructions

This repository is the canonical source for `@cxyi7/repo-guard`.

## 分支命名与创建

- 新建工作分支统一使用 `<type>/<topic>-<version>`，例如 `feat/commit-animation-1.24.0`。本仓库使用下述类型前缀，不使用 `codex/` 或仅版本号作为新工作分支名；用户明确指定其他名称时遵循用户要求。
- `type` 按本次工作的主要目的选择：`feat` 新功能、`fix` 修复、`docs` 文档、`style` 格式、`refactor` 重构、`perf` 性能、`test` 测试、`build` 构建、`ci` 持续集成、`chore` 日常维护。
- `topic` 使用简短、具体的小写英文单词，以连字符连接；不要使用空格、下划线、中文或 `temp`、`update` 等无法说明工作内容的名称。
- `version` 为本次工作的目标版本，使用不带 `v` 的 `主版本.次版本.修订版本`，例如 `1.24.0`。版本判断沿用 `.agents/skills/repo-guard-publishing/SKILL.md`；分支名不代表已经发布，也不要求建分支时立即修改包版本。
- 开始独立功能或修复前，先检查当前分支、工作区及本地和远程已有分支。已有同一任务的分支时继续使用；没有时，先创建符合规则的工作分支再修改，不直接在 `main` 开发。
- 默认从最新主分支创建独立工作分支；用户指定基线或任务依赖其他分支时使用对应基线。切换前保留已有修改，不丢弃或覆盖用户工作。
- 一个工作分支聚焦一个可独立评审的目标；为该目标补充的测试、文档和审查修复留在同一分支，不因改动文件类型不同反复新建分支。目标版本调整时同步分支名称，避免名称与交付目标不一致。
- 创建前使用 `git check-ref-format --branch <分支名>` 验证 Git 格式，并核对以上命名约定。旧分支不因新增此规范批量改名；后续新建分支必须遵循。

## 实现与维护约束

- Keep protected-file checks and staged-code quality checks as separate modules.
- The pre-commit order is fixed: Stylelint fix, ESLint fix, Prettier, read-only Stylelint and ESLint verification, then the protected-file gate.
- Never run a project-wide fix command from a Git hook.
- Use the consuming project's ESLint, Prettier, and Stylelint installations and configurations.
- Use the consuming Vue project's Lighthouse CI installation, Chrome environment, routes, and assertions; never upload Lighthouse reports implicitly.
- Keep Lighthouse out of pre-commit; it may run explicitly or from the optional pre-push gate.
- Do not add TypeScript type checking to the pre-commit gate.
- Preserve partially staged and unstaged changes through `lint-staged`.
- 退出码、检查状态映射及汇总优先级只在 `src/core/result/exit-code.js` 维护。命令、Hook、CI、多应用、交付和运维入口必须复用公共常量与映射/汇总函数，不得自行返回数字码、压缩失败类型、取首个非零值或透传第三方进程退出码。第三方原始码保留为诊断，由适配层说明其语义；启动失败、超时、信号终止一律为执行错误。
- 统一退出码为成功或非阻断 `0`、配置/执行错误 `1`、违规或交付条件未满足 `2`、不可信 Git 范围 `3`；多个阻断结果按执行错误、配置错误、范围错误、违规的优先级汇总，与应用和步骤排列无关。先选择需阻断的结果再汇总；CI 只报告和成功的状态查询可返回 `0`，但跳过不能作为交付通过证据。
- 只有 `bin/repo-guard.js` 可以写入主进程退出码，写入前必须通过公共校验。生成的运维子脚本必须注入公共退出码常量，不能另建码表。新增入口或失败分类时同步退出码边界测试、跨入口行为测试及 `docs/features/gate-result-and-reporting.md`，不得以测试白名单绕过统一处理。
- 托管 Hook 和规范区块只接受当前格式；旧版或未知标记必须拒绝，不转换或覆盖既有文件。repo-guard 自有配置、报告、登记表和基线只使用文档规定的当前格式，不得新增旧版读取器或转换路径。
- Every behavior change requires tests and synchronized README/config schema updates.
- Treat `docs/project-structure-and-feature-inventory.md` and `docs/features/` as the joint
  long-lived capability documentation. Every feature addition, change, or removal must update
  `docs/features/README.md` and its feature document in the same change. Update the project
  overview when capability domains, lifecycles, repository structure, module responsibilities,
  or dependency directions change.
- All repo-guard-authored user-facing statuses, warnings, errors, evidence, expectations,
  remediation steps, constraints, and verification guidance must use Simplified Chinese.
  Keep stable machine identifiers, commands, paths, package names, and third-party rule IDs
  unchanged. Isolate third-party raw diagnostics from the primary Chinese explanation and
  label them explicitly. The English-text migration baseline may only shrink; after translating
  existing debt, use `npm run language:prune-baseline` and review that it only removes allowances.
  Never add, replace, or regenerate baseline entries to bypass the language check.
- For version selection, release preparation, npm authentication, publishing, and registry
  verification, use `.agents/skills/repo-guard-publishing/SKILL.md` as the only maintained
  release workflow for this repository.
- Use `npm run lint:fix` only for explicit repository-wide maintenance; consumer Hooks remain staged-only.
