# Valedictorian

Local-first desktop app for tracking job applications.

## Workspace Data

Valedictorian stores workspace state in the selected workspace folder:

```text
<workspace>/.valedictorian/
```

The workspace manifest lives at `<workspace>/.valedictorian/manifest.json`.

### Profile storage and recovery

`<workspace>/.valedictorian/profile.json` is the canonical source for the non-secret profile. Profile JSON never contains SSN material. The PGlite-only runtime never reads or migrates the legacy SQLite file; workspaces that have that file but no `profile.json` fail closed and require a staged upgrade. See `UPGRADING.md` for the supported upgrade path and immutable migration-evidence policy.

Invalid JSON blocks profile reads and updates until it is corrected or restored. To restore the one-generation profile backup through the local API, use the workspace route:

```sh
curl -X POST "$VALEDICTORIAN_API_URL/v1/workspaces/$WORKSPACE_ID/profile/document/restore" \
  -H 'content-type: application/json' \
  --data '{"expectedRevision":null}'
```

Use `expectedRevision: null` only when the current document is unreadable; otherwise provide the current revision to prevent overwriting a concurrent edit.

## Project config discovery

When opening a new project folder, the app can read workspace defaults from `valedictorian.config.json`, `.valedictorianrc.json`, or the `valedictorian` key in `package.json`.

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
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
```

`pnpm dev` is the normal interactive development command. It uses the selected
Valedictorian workspace and app user-data location; it is not an isolated proof
command.

### Isolated validation

```sh
pnpm run validate:isolated
```

This launches the current worktree with a disposable user-data root and
workspace, a fixed versioned unresolved Capture and Company fixture, a unique
strict renderer port, and an operating-system-selected local API port. It
never reads a prior workspace, inherits no token/secret environment variables,
uses no live provider, and disables update polling only for this validation
mode. On readiness Electron atomically writes a mode-`0600`, schema-validated,
secret-free session manifest into the printed evidence directory. Closing the
session, interrupting it, a child failure, or its timeout terminates the owned
Vite/Electron process group and removes only that command's temporary root;
the evidence directory remains. The default timeout is 15 minutes and may be
shortened for a development check:

```sh
pnpm run validate:isolated -- --timeout-ms 20000
```

Failures retain a bounded `diagnostics.json` in that evidence directory rather
than the disposable workspace or user-data root.

### Complete development proof

```sh
pnpm run proof:dev
```

This is the single deterministic cross-surface development proof. It owns an
isolated fixture lifecycle, launches the current-worktree Electron renderer,
and invokes the repository-pinned Valedictorian CLI directly from its local
package—never from `PATH`. The CLI first reads the unresolved fixture Capture
through the ready session manifest's exact loopback API and explicit workspace.
The UI completes that Capture, the CLI verifies its exact revision and evidence
lineage in the resulting Job and Workspace Company, then performs one guarded
Company display-name mutation. Finally, the UI observes the CLI value.

The retained `cli-ui-dev-proof.json` binds the run, workspace, fixture, app
build, CLI `0.1.0-alpha.18` commit and executable hash, structured assertions,
bounded diagnostics, and app-only before/after PNG hashes. The command uses no
live provider or credentials and preserves the isolated lifecycle's teardown on
success, failure, timeout, or signal. Headless Linux runs under Xvfb.

### Electron native UI proof

```sh
pnpm run proof:electron
```

This uses the same isolated fixture lifecycle but drives the current-worktree
Electron renderer through accessible roles and labels: it completes the fixed
unresolved Capture through the visible completion dialog, then verifies the
created Job and its Workspace Company in the rendered Jobs and Companies
tables. The command prints a retained `electron-native-ui-proof.json` evidence
path with build/worktree identity, bounded renderer diagnostics, and app-only
before/after PNG hashes. It never uses live providers or credentials. On
headless Linux it starts the proof under an isolated Xvfb display.

### Packaged proof

Packaged proof is separate from both interactive development and isolated
validation. Build first, then run the package-only smoke commands against the
produced application artifacts:

```sh
pnpm build
pnpm run smoke:pglite-package
pnpm run smoke:manual-workflow-package
```

## Release

Mac releases are built by `.github/workflows/release-mac.yml` from manual runs or `v*` tags.

```sh
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```
