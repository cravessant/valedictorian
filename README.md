# Job App

Local-first desktop app for tracking job applications and preparing automation handoffs.

## Alpha Scope

This repo currently targets a private Mac alpha. The packaged app is unsigned, stores meaningful local state inside a user-chosen workspace folder, and does not include sync, auto-updates, or a secrets redesign yet.

Workspace state lives under:

```text
<workspace>/.job-automation/
```

The app keeps only a small recent-workspace registry in the Electron app-data folder so it can reopen the last valid workspace on launch.

## Development

Use the mise-managed runtimes from this machine, then run:

```sh
pnpm install
pnpm dev
```

Useful checks:

```sh
pnpm test
pnpm typecheck
pnpm lint
```

`sparxie` is consumed from the public npm registry as a pinned dependency. Publish a new `sparxie` version before updating this app when shared contracts change.

## Mac Alpha Release

The GitHub Actions workflow at `.github/workflows/release-mac.yml` supports:

- manual runs from the Actions tab
- tag-triggered releases for tags matching `v*`

For a tagged alpha release:

```sh
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

The workflow installs from `pnpm-lock.yaml`, runs tests, typecheck, and lint, builds the Mac DMG, uploads it as an Actions artifact, and attaches it to a GitHub prerelease.

Because `electron-builder.json5` has `mac.identity` set to `null`, the DMG is intentionally unsigned for this alpha.
