# Repository instructions

This repository is the canonical source for `@cxyi7/repo-guard`.

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
