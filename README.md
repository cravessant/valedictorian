# Valedictorian

Local-first desktop app for tracking job applications.

## Workspaces

All workspace data lives in the selected folder:

```text
<workspace>/.valedictorian/
```

The workspace manifest is `<workspace>/.valedictorian/manifest.json`.
The non-secret profile is stored in `.valedictorian/profile.json`; secrets are
encrypted separately. The PGlite-only runtime never reads or migrates the legacy SQLite file.
See `UPGRADING.md` before opening an older workspace.

## Project config discovery

New projects can provide workspace defaults in `valedictorian.config.json`,
`.valedictorianrc.json`, or the `valedictorian` key in `package.json`:

```json
{
  "version": 1,
  "workspace": {
    "name": "Summer Search"
  }
}
```

Do not store API tokens, OAuth tokens, passwords, or client secrets in project config.

## Development

```sh
mise install
pnpm install
pnpm dev
```

Common commands:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run against your selected workspace |
| `pnpm run dev:isolated` | Run with a blank, disposable workspace |
| `pnpm test` | Run the test suite |
| `pnpm typecheck` | Check TypeScript |
| `pnpm lint` | Run repository checks |
| `pnpm run validate:isolated` | Open a disposable workspace with validation fixtures |
| `pnpm run proof:dev` | Verify the CLI and UI together |
| `pnpm run proof:electron` | Verify the native Electron workflow |

The isolated commands do not use your existing workspace or live credentials.
For packaged smoke tests:

```sh
pnpm build
pnpm run smoke:pglite-package
pnpm run smoke:manual-workflow-package
```

## Release

Mac releases are built by `.github/workflows/release-mac.yml` from a manual run
or a `v*` tag:

```sh
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```
