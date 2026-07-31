# Repository instructions

This repository is the canonical source for `@cxyi7/repo-guard`.

- Keep protected-file checks and staged-code quality checks as separate modules.
- The pre-commit order is fixed: staged ESLint gate first, protected-file gate second.
- Never run a project-wide fix command from a Git hook.
- Use the consuming project's ESLint installation and configuration.
- Do not add TypeScript type checking to the pre-commit gate.
- Preserve partially staged and unstaged changes through `lint-staged`.
- Managed Hook upgrades must accept known older markers but generate only the current version.
- Every behavior change requires tests and synchronized README/config schema updates.
- Run `npm run check`, `npm test`, and `npm run pack:check` before publishing.
- Use `npm run lint:fix` only for explicit repository-wide maintenance; consumer Hooks remain staged-only.
