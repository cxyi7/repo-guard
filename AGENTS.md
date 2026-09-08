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
- Managed Hook upgrades must accept known older markers but generate only the current version.
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
