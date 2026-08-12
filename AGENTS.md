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
- Version every independently released change by impact: use a patch release for one small
  rule or localized compatible enhancement, a minor release for a substantial new gate or
  workflow, and explicitly review any incompatible change before selecting a major release.
- Keep one independently reviewed feature in one release; do not bundle the next feature into
  a version that has already completed review.
- Run `npm run check`, `npm test`, and `npm run pack:check` before publishing.
- Always authenticate to npm in a new visible terminal with the official Web login and
  account 2FA flow. Verify that `npm whoami` returns `cxyi7`, then publish from a second
  visible terminal opened in this repository.
- Never store npm passwords, access tokens, recovery codes, or one-time 2FA codes in the
  repository, shell scripts, command history, logs, or documentation.
- Use `npm run lint:fix` only for explicit repository-wide maintenance; consumer Hooks remain staged-only.
