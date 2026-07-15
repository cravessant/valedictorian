# Valedictorian UI Theme

`valedictorian-app` uses Tailwind CSS v4 with local shadcn-style React primitives in `src/components/ui`.

## Visual Direction

The default interface theme uses the Catppuccin Blur Mocha palette, with structure informed by Zed's official UI/theme model:

- Primary background uses Catppuccin Blur Mocha `background`: `#1e1e2ed7`.
- App panels use Catppuccin Mocha base/mantle surfaces such as `#181825cc`.
- Borders use Catppuccin Mocha surface tones such as `#31324499`.
- Accent uses Catppuccin lavender: `#cba6f7`.
- Text uses Catppuccin Mocha `text`: `#cdd6f4`, with muted text from `#a6adc8`.
- Semantic colors use Catppuccin green/yellow/red values for success, warning, and destructive states.

Use official Zed sources for interface role mapping and restraint: real app state can have panes, tabs, bars, and panels, but do not invent extra editor chrome, tab bars, glow dots, or decorative panels just to make the app look more like an editor.

The main theme tokens live in `src/index.css`. Keep future UI work aligned with those CSS variables and Tailwind utilities before introducing new hard-coded colors.

## Theme Source

The theme is based on Catppuccin Blur colors and official Zed structure sources:

- Catppuccin Blur for Zed: https://github.com/jenslys/zed-catppuccin-blur
- Zed repository: https://github.com/zed-industries/zed
- Official One theme JSON: https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json
- Zed default settings: https://github.com/zed-industries/zed/blob/main/assets/settings/default.json
- shadcn/ui Vite setup: https://v3.shadcn.com/docs/installation/vite
- Tailwind CSS Vite setup: https://tailwindcss.com/docs/installation/using-vite

Use Catppuccin Blur Mocha as the default color source unless the user explicitly asks for another Catppuccin flavor.

## Harness Boundary

`valedictorian-app` is the deterministic app surface and policy source of truth for external coding harnesses such as Codex or Claude Code. Do not build an embedded OpenRouter loop, browser agent, cron runner, auto-submitter, or automatic database unlocker into the desktop app for v1.

Policy configuration changes should only affect app decisions: queue buckets, validation gates, required evidence, displayed reasons, and scheduler-ready run-window recommendations. External harnesses remain responsible for executing actions through explicit app APIs.

## Agent skills

This repo keeps agent-owned support files in `.local/`, which is intentionally gitignored.

### Issue tracker

Issues, PRDs, triage, QA reports, and refactor plans live in GitHub Issues. See `.local/agents/issue-tracker.md`.

### Triage labels

Use the repo's configured GitHub labels. See `.local/agents/triage-labels.md`.

### Domain docs

Local-only domain context and ADRs live under `.local/context/` and `.local/adr/`. See `.local/agents/domain.md`.

## Pre-commit and CI

- A `lefthook` `pre-commit` hook runs `oxlint` on staged JS/TS files. Hooks install on `pnpm install`; if they are missing, run `pnpm exec lefthook install`.
- Never bypass the hook: no `git commit --no-verify`, `LEFTHOOK=0`, or `LEFTHOOK_EXCLUDE`, and do not disable or weaken lint rules to force a commit through.
- `oxlint` enforces `max-lines` at 1000 (blank and comment lines excluded). If a file exceeds it, split the file — do not add `oxlint-disable` comments or raise the limit to get around it.
- Unless a JavaScript or TypeScript file is genuinely machine-generated, the line-of-code limit must never be bypassed. Tests, fixtures, configuration, and handwritten migration helpers remain subject to the limit.
- The only permitted exemption is an exact path whose contents are machine-generated and whose source of truth is the generator. Document the generator command and never use an exemption, override, disable, ignore, alternate lint path, or hook/CI bypass for maintained code.
- CI (`.github/workflows/ci.yml`) runs `pnpm test`, `pnpm typecheck`, and `pnpm lint` on every push and PR. Run `pnpm lint && pnpm test` locally and make it pass **before** you push.
- Do not push or merge with CI failing. A red pipeline is a stop signal — fix the code, not the check.
