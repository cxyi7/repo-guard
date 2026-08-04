# Repository instructions

This repository is the canonical source for `@cxyi7/repo-guard`.

- Keep protected-file checks and staged-code quality checks as separate modules.
- The pre-commit order is fixed: Stylelint fix, ESLint fix, Prettier, read-only Stylelint and ESLint verification, then the protected-file gate.
- Never run a project-wide fix command from a Git hook.
- Use the consuming project's ESLint, Prettier, and Stylelint installations and configurations.
- Do not add TypeScript type checking to the pre-commit gate.
- Preserve partially staged and unstaged changes through `lint-staged`.
- Managed Hook upgrades must accept known older markers but generate only the current version.
- Every behavior change requires tests and synchronized README/config schema updates.
- Run `npm run check`, `npm test`, and `npm run pack:check` before publishing.
- Always authenticate to npm in a new visible terminal with the official Web login and
  account 2FA flow. Verify that `npm whoami` returns `cxyi7`, then publish from a second
  visible terminal opened in this repository.
- Never store npm passwords, access tokens, recovery codes, or one-time 2FA codes in the
  repository, shell scripts, command history, logs, or documentation.
- Use `npm run lint:fix` only for explicit repository-wide maintenance; consumer Hooks remain staged-only.
