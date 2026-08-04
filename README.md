# Valedictorian

Local-first desktop app for tracking job applications.

## Install

Install the prerelease CLI from the public npm registry:

```sh
pnpm --registry=https://registry.npmjs.org/ \
  --config.minimumReleaseAge=0 \
  add -g @sparxie/valedictorian-cli@alpha
```

Install the public lifecycle and application skills from this repository:

```sh
npx --yes skills add cravessant/valedictorian \
  --global \
  --agent codex \
  --skill valedictorian-cli \
  --skill valedictorian-application-agent \
  --yes
```

The product also publishes these npmjs package boundaries:

- `@sparxie/valedictorian-connectors-core`
- `@sparxie/valedictorian-connectors-test-harness`
- `@sparxie/valedictorian-workspace-server`
- `@sparxie/valedictorian-workspace-client`
- `@sparxie/valedictorian-workspace-conformance`
- `@sparxie/valedictorian-local-runtime`

Use [GitHub Issues](https://github.com/cravessant/valedictorian/issues) for
package and product defects.

## Workspaces

All workspace data lives in the selected folder:

```text
<workspace>/.valedictorian/
```

The workspace manifest is `<workspace>/.valedictorian/manifest.json`.
The non-secret profile is stored in `.valedictorian/profile.json`; secrets are
encrypted separately. Only this layout is supported: a workspace created by an
older pre-release must be recreated rather than upgraded.

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

## Database

The schema ships as one generated baseline (see `packages/local-runtime/drizzle/README.md`). Because this
is a pre-release schema with no installed databases, the baseline is regenerated in
place rather than extended, so a database created before a regeneration is not
supported: delete it and let the app recreate it.

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
| `pnpm run test:window` | Run tests that open real app windows |
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

The current signed and notarized macOS alpha is `0.1.0-alpha.55`:

- [DMG installer](https://updates.valedictorian.app/mac/alpha/Valedictorian-Mac-0.1.0-alpha.55-Installer.dmg) — SHA-256 `db920bafe4db708a2eb117dbeb3ac78197927cc75ef4b95d26a29f7e405a1515`
- [ZIP archive](https://updates.valedictorian.app/mac/alpha/Valedictorian-Mac-0.1.0-alpha.55-Installer.zip) — SHA-256 `b2c96824959e1d9d12b392d35ab03bc3df9b9729946fdbb0114b5e075db526d3`
- [Update metadata](https://updates.valedictorian.app/mac/alpha/latest-mac.yml)

[GitHub Releases](https://github.com/cravessant/valedictorian/releases) will
provide versioned release history in the future; the update feed above is the
current download source.
Package publishers, tag namespaces, migration canaries, and promotion commands
are documented in [`RELEASING.md`](RELEASING.md).
