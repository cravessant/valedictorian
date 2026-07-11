# valedictorian-cli Agent Instructions

`valedictorian-cli` is the command-line client for Valedictorian.

## Pre-commit and CI

- A `lefthook` `pre-commit` hook runs `oxlint` on staged JS/TS files. Hooks install on `pnpm install`; if they are missing, run `pnpm exec lefthook install`.
- Never bypass the hook: no `git commit --no-verify`, `LEFTHOOK=0`, or `LEFTHOOK_EXCLUDE`, and do not disable or weaken lint rules to force a commit through.
- `oxlint` enforces `max-lines` at 1000 (blank and comment lines excluded). If a file exceeds it, split the file — do not add `oxlint-disable` comments or raise the limit to get around it.
- CI (`.github/workflows/ci.yml`) runs `pnpm test`, `pnpm lint`, and `pnpm build` on every push and PR. Run `pnpm lint && pnpm test && pnpm build` locally and make it pass **before** you push.
- Do not push or merge with CI failing. A red pipeline is a stop signal — fix the code, not the check.
