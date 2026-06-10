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
